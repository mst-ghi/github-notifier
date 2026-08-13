import { EventEmitter } from 'node:events';
import { EVENT_SEVERITY, truncate } from '../shared/format';
import type {
  AppNotification,
  EventType,
  HandledWebhookDelivery,
  NotificationSource,
  PullRequestSnapshot,
  RepoEventFilters,
} from '../shared/types';
import { type RepoRow, toEventFilters } from './db/rows';
import { fromSqlBool } from './db/sqlite';
import { childLogger } from './logger';
import { type NewNotification, createNotification } from './notification-service';
import { findRepoByGithubId, touchRepoEvent } from './repo-service';
import { getSettings } from './settings-service';

const log = childLogger('events');

/** Maps an event type onto the per-repo filter switch that gates it. */
const FILTER_BY_EVENT: Readonly<Record<EventType, keyof RepoEventFilters | null>> = {
  pr_comment: 'comments',
  pr_review_comment: 'comments',
  pr_review: 'reviews',
  pr_merged: 'merges',
  pr_closed: 'merges',
  pr_conflict: 'conflicts',
  pr_conflict_resolved: 'conflicts',
  check_failed: 'checks',
  check_succeeded: 'checks',
  pr_assigned: 'assignments',
  review_requested: 'assignments',
  system: null,
};

export interface ProcessorEvents {
  notification: [AppNotification];
}

/** Emitted for every notification that was actually new. */
export class EventProcessor extends EventEmitter<ProcessorEvents> {
  private currentUser = '';

  setCurrentUser(login: string): void {
    this.currentUser = login;
  }

  get user(): string {
    return this.currentUser;
  }

  /**
   * Stores a notification if the repo's filters allow it and it is not a
   * duplicate. Returns the stored notification, or null when it was skipped.
   */
  async record(
    repo: RepoRow | null,
    input: Omit<NewNotification, 'userId'>
  ): Promise<AppNotification | null> {
    if (!this.currentUser) {
      log.warn('no authenticated user yet, dropping event');
      return null;
    }

    const filterKey = FILTER_BY_EVENT[input.eventType];
    if (repo && filterKey && !toEventFilters(repo)[filterKey]) {
      log.debug({ repo: repo.full_name, eventType: input.eventType }, 'event filtered out');
      return null;
    }
    if (repo && !fromSqlBool(repo.monitoring)) {
      log.debug({ repo: repo.full_name }, 'repo not monitored, dropping event');
      return null;
    }

    const created = createNotification({ ...input, userId: this.currentUser });
    if (created) {
      this.emit('notification', created);
      if (created.repoId !== null) {
        touchRepoEvent(created.repoId);
      }
    }
    return created;
  }

  /* ---------------------------------------------------------------- */
  /* Webhook deliveries                                                */
  /* ---------------------------------------------------------------- */

  /** Turns one webhook delivery into zero or more notifications. */
  async handleWebhook(delivery: HandledWebhookDelivery): Promise<AppNotification[]> {
    const settings = getSettings();
    const onlyMine = settings.onlyMyPullRequests;
    const results: AppNotification[] = [];

    const push = async (
      repo: RepoRow | null,
      input: Omit<NewNotification, 'userId'>
    ): Promise<void> => {
      const created = await this.record(repo, input);
      if (created) {
        results.push(created);
      }
    };

    switch (delivery.name) {
      case 'ping':
      case 'push':
        // Acknowledged so GitHub shows a green delivery, but nothing to notify.
        break;

      case 'pull_request': {
        const { payload } = delivery;
        const repo = findRepoByGithubId(payload.repository.id);
        const pull = payload.pull_request;
        const isMine = pull.user.login === this.currentUser;
        const actor = payload.sender.login;

        if (payload.action === 'closed') {
          if (onlyMine && !isMine) {
            break;
          }
          const merged = pull.merged === true;
          await push(repo, {
            repoName: payload.repository.full_name,
            repoId: payload.repository.id,
            prNumber: pull.number,
            prTitle: pull.title,
            eventType: merged ? 'pr_merged' : 'pr_closed',
            severity: EVENT_SEVERITY[merged ? 'pr_merged' : 'pr_closed'],
            source: 'webhook',
            message: merged
              ? `${actor} merged "${truncate(pull.title, 80)}"`
              : `${actor} closed "${truncate(pull.title, 80)}" without merging`,
            url: pull.html_url,
            actor,
            actorAvatarUrl: payload.sender.avatar_url,
            dedupeKey: `pr:${pull.id}:${merged ? 'merged' : 'closed'}`,
          });
          break;
        }

        if (payload.action === 'assigned' && payload.assignee?.login === this.currentUser) {
          await push(repo, {
            repoName: payload.repository.full_name,
            repoId: payload.repository.id,
            prNumber: pull.number,
            prTitle: pull.title,
            eventType: 'pr_assigned',
            source: 'webhook',
            message: `${actor} assigned you "${truncate(pull.title, 80)}"`,
            url: pull.html_url,
            actor,
            actorAvatarUrl: payload.sender.avatar_url,
            dedupeKey: `pr:${pull.id}:assigned:${this.currentUser}`,
          });
          break;
        }

        if (
          payload.action === 'review_requested' &&
          'requested_reviewer' in payload &&
          payload.requested_reviewer?.login === this.currentUser
        ) {
          await push(repo, {
            repoName: payload.repository.full_name,
            repoId: payload.repository.id,
            prNumber: pull.number,
            prTitle: pull.title,
            eventType: 'review_requested',
            source: 'webhook',
            message: `${actor} requested your review on "${truncate(pull.title, 80)}"`,
            url: pull.html_url,
            actor,
            actorAvatarUrl: payload.sender.avatar_url,
            dedupeKey: `pr:${pull.id}:review_requested:${this.currentUser}`,
          });
        }
        break;
      }

      case 'issue_comment': {
        const { payload } = delivery;
        // `issue_comment` fires for issues too. Only PRs carry `pull_request`.
        if (!payload.issue.pull_request) {
          break;
        }
        if (payload.action !== 'created') {
          break;
        }
        const actor = payload.comment.user.login;
        if (actor === this.currentUser) {
          break; // never notify about your own comment
        }
        const isMine = payload.issue.user.login === this.currentUser;
        if (onlyMine && !isMine) {
          break;
        }
        const repo = findRepoByGithubId(payload.repository.id);
        await push(repo, {
          repoName: payload.repository.full_name,
          repoId: payload.repository.id,
          prNumber: payload.issue.number,
          prTitle: payload.issue.title,
          eventType: 'pr_comment',
          source: 'webhook',
          message: `${actor} commented: ${truncate(payload.comment.body, 120)}`,
          detail: truncate(payload.comment.body, 600),
          url: payload.comment.html_url,
          actor,
          actorAvatarUrl: payload.comment.user.avatar_url,
          dedupeKey: `comment:${payload.comment.id}`,
        });
        break;
      }

      case 'pull_request_review_comment': {
        const { payload } = delivery;
        if (payload.action !== 'created') {
          break;
        }
        const actor = payload.comment.user.login;
        if (actor === this.currentUser) {
          break;
        }
        if (onlyMine && payload.pull_request.user.login !== this.currentUser) {
          break;
        }
        const repo = findRepoByGithubId(payload.repository.id);
        await push(repo, {
          repoName: payload.repository.full_name,
          repoId: payload.repository.id,
          prNumber: payload.pull_request.number,
          prTitle: payload.pull_request.title,
          eventType: 'pr_review_comment',
          source: 'webhook',
          message: `${actor} commented on ${payload.comment.path}: ${truncate(payload.comment.body, 100)}`,
          detail: truncate(payload.comment.body, 600),
          url: payload.comment.html_url,
          actor,
          actorAvatarUrl: payload.comment.user.avatar_url,
          dedupeKey: `review_comment:${payload.comment.id}`,
        });
        break;
      }

      case 'pull_request_review': {
        const { payload } = delivery;
        if (payload.action !== 'submitted') {
          break;
        }
        const actor = payload.review.user.login;
        if (actor === this.currentUser) {
          break;
        }
        if (onlyMine && payload.pull_request.user.login !== this.currentUser) {
          break;
        }
        const repo = findRepoByGithubId(payload.repository.id);
        const state = payload.review.state.toLowerCase();
        const verdict =
          state === 'approved'
            ? 'approved'
            : state === 'changes_requested'
              ? 'requested changes on'
              : 'reviewed';
        await push(repo, {
          repoName: payload.repository.full_name,
          repoId: payload.repository.id,
          prNumber: payload.pull_request.number,
          prTitle: payload.pull_request.title,
          eventType: 'pr_review',
          severity: state === 'changes_requested' ? 'warning' : 'info',
          source: 'webhook',
          message: `${actor} ${verdict} "${truncate(payload.pull_request.title, 70)}"`,
          detail: payload.review.body ? truncate(payload.review.body, 600) : null,
          url: payload.review.html_url,
          actor,
          actorAvatarUrl: payload.review.user.avatar_url,
          dedupeKey: `review:${payload.review.id}`,
        });
        break;
      }

      case 'check_suite': {
        const { payload } = delivery;
        if (payload.action !== 'completed') {
          break;
        }
        const suite = payload.check_suite;
        const pulls = suite.pull_requests ?? [];
        if (pulls.length === 0) {
          break;
        }
        const failed = suite.conclusion !== 'success';
        const repo = findRepoByGithubId(payload.repository.id);
        for (const pull of pulls) {
          await push(repo, {
            repoName: payload.repository.full_name,
            repoId: payload.repository.id,
            prNumber: pull.number,
            prTitle: null,
            eventType: failed ? 'check_failed' : 'check_succeeded',
            source: 'webhook',
            message: failed
              ? `Checks failed on #${pull.number} (${suite.conclusion ?? 'unknown'})`
              : `All checks passed on #${pull.number}`,
            url: `https://github.com/${payload.repository.full_name}/pull/${pull.number}/checks`,
            actor: null,
            dedupeKey: `check_suite:${suite.id}:${pull.number}`,
          });
        }
        break;
      }

      case 'check_run':
        // Covered by `check_suite`; subscribing to both would double-notify.
        break;

      default: {
        // Exhaustiveness guard: adding a variant to the union breaks the build here.
        const unreachable: never = delivery;
        log.debug({ delivery: unreachable }, 'unhandled webhook event');
      }
    }

    return results;
  }

  /* ---------------------------------------------------------------- */
  /* Poller findings                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Conflict detection. There is no GitHub event for "this PR now has
   * conflicts", so the poller compares `mergeable` between scans and calls this
   * when it flips.
   */
  async recordConflict(
    repo: RepoRow | null,
    pull: PullRequestSnapshot,
    resolved: boolean
  ): Promise<AppNotification | null> {
    const eventType: EventType = resolved ? 'pr_conflict_resolved' : 'pr_conflict';
    return this.record(repo, {
      repoName: pull.repoFullName,
      repoId: pull.repoId,
      prNumber: pull.number,
      prTitle: pull.title,
      eventType,
      source: 'poller',
      message: resolved
        ? `Conflicts resolved on "${truncate(pull.title, 80)}"`
        : `"${truncate(pull.title, 80)}" has merge conflicts with ${pull.baseRef}`,
      detail: resolved
        ? null
        : `Rebase or merge ${pull.baseRef} into ${pull.headRef} to fix the conflict.`,
      url: pull.htmlUrl,
      actor: pull.authorLogin,
      actorAvatarUrl: pull.authorAvatarUrl,
      // headSha in the key means one notification per conflicting commit, not
      // one per poll tick.
      dedupeKey: `conflict:${pull.id}:${pull.headSha}:${resolved ? 'resolved' : 'dirty'}`,
    });
  }

  /** Generic entry point used by the notifications-API poller. */
  async recordFromPoller(
    repo: RepoRow | null,
    input: Omit<NewNotification, 'userId' | 'source'>,
    source: NotificationSource = 'poller'
  ): Promise<AppNotification | null> {
    return this.record(repo, { ...input, source });
  }
}

export const eventProcessor = new EventProcessor();
