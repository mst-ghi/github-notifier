import { errorMessage } from '../shared/errors';
import { truncate } from '../shared/format';
import type { EventType, GithubNotificationThread } from '../shared/types';
import type { RepoRow } from './db/rows';
import type { EventProcessor } from './event-processor';
import type { GithubApi } from './github-api';
import { childLogger } from './logger';
import { pruneOldNotifications } from './notification-service';
import {
  findRepoByFullName,
  findRepoByGithubId,
  listMonitoredRepos,
  markConflictScanned,
} from './repo-service';
import { getNotificationCursor, getSettings, setNotificationCursor } from './settings-service';

const log = childLogger('poller');

/**
 * Polling engine.
 *
 * This is the part that actually works on a normal desktop, because GitHub
 * cannot POST a webhook to a machine behind NAT. It also covers the one thing
 * webhooks can never report: a pull request that has *become* unmergeable
 * because something else landed on the base branch.
 */

/**
 * Reasons that mean the pull request is yours or the activity is aimed at you.
 *
 * The webhook path already honours `onlyMyPullRequests`; without this the
 * poller ignored it, so the two sources disagreed about what counted.
 */
const PERSONAL_REASONS: ReadonlySet<string> = new Set([
  'author',
  'assign',
  'review_requested',
  'mention',
  'team_mention',
  'manual',
]);

/** GitHub's `reason` field mapped onto our event types. */
const REASON_TO_EVENT: Readonly<Record<string, EventType>> = {
  comment: 'pr_comment',
  author: 'pr_comment',
  mention: 'pr_comment',
  team_mention: 'pr_comment',
  review_requested: 'review_requested',
  assign: 'pr_assigned',
  state_change: 'pr_closed',
  subscribed: 'pr_comment',
  ci_activity: 'check_failed',
  manual: 'pr_comment',
};

/** A finished pull request stays finished, so this can be cached generously. */
const CLOSED_STATE_TTL_MS = 30 * 60_000;

export interface PollerOptions {
  github: GithubApi;
  processor: EventProcessor;
}

export class Poller {
  private readonly github: GithubApi;
  private readonly processor: EventProcessor;
  private notificationTimer: NodeJS.Timeout | null = null;
  private conflictTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = false;
  private lastPollAt: Date | null = null;
  private lastError: string | null = null;
  /** PR id -> whether it was conflicting on the previous scan. */
  private readonly conflictState = new Map<number, boolean>();
  /**
   * `owner/repo#number` -> was it already finished, and when we last checked.
   *
   * A merged pull request is done: late comments on it are not work, and the
   * notifications API keeps returning the thread. One lookup per pull request
   * we are about to record, cached, is far cheaper than one per poll.
   */
  private readonly closedState = new Map<string, { closed: boolean; checkedAt: number }>();

  constructor(options: PollerOptions) {
    this.github = options.github;
    this.processor = options.processor;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get lastPoll(): Date | null {
    return this.lastPollAt;
  }

  get lastPollError(): string | null {
    return this.lastError;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    const settings = getSettings();
    this.running = true;

    this.notificationTimer = setInterval(() => {
      void this.pollNotifications();
    }, settings.pollIntervalSeconds * 1000);
    this.notificationTimer.unref?.();

    this.conflictTimer = setInterval(() => {
      void this.pollConflicts();
    }, settings.conflictPollIntervalSeconds * 1000);
    this.conflictTimer.unref?.();

    // Housekeeping once an hour keeps the collection from growing forever.
    this.pruneTimer = setInterval(() => {
      void this.prune();
    }, 3600_000);
    this.pruneTimer.unref?.();

    log.info(
      {
        pollIntervalSeconds: settings.pollIntervalSeconds,
        conflictIntervalSeconds: settings.conflictPollIntervalSeconds,
      },
      'poller started'
    );

    // First pass immediately so the app has data without waiting a full cycle.
    void this.pollNow();
  }

  stop(): void {
    for (const timer of [this.notificationTimer, this.conflictTimer, this.pruneTimer]) {
      if (timer) {
        clearInterval(timer);
      }
    }
    this.notificationTimer = null;
    this.conflictTimer = null;
    this.pruneTimer = null;
    this.running = false;
    log.info('poller stopped');
  }

  /** Restart with the current settings. Call after the intervals change. */
  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  /** Runs both passes once, on demand (tray "Check now", control API). */
  async pollNow(): Promise<void> {
    await this.pollNotifications();
    await this.pollConflicts();
  }

  /* ---------------------------------------------------------------- */
  /* Pass 1: the GitHub notifications API                              */
  /* ---------------------------------------------------------------- */

  private async pollNotifications(): Promise<void> {
    if (this.busy || !this.github.isReady) {
      return;
    }
    this.busy = true;
    try {
      const since = getNotificationCursor();
      const threads = await this.github.listNotifications(since);
      this.lastPollAt = new Date();
      this.lastError = null;

      if (threads.length === 0) {
        log.debug('no new GitHub notification threads');
        return;
      }

      let recorded = 0;
      let newestSeen: string | null = null;

      for (const thread of threads) {
        const created = await this.handleThread(thread);
        if (created) {
          recorded += 1;
        }
        if (newestSeen === null || thread.updatedAt > newestSeen) {
          newestSeen = thread.updatedAt;
        }
      }

      /*
       * Advance only past threads that were actually processed, and only once
       * the whole batch got through.
       *
       * This used to move the cursor to "now" regardless. On a first run the
       * poller ticks before any repository is being watched, recorded nothing,
       * and still jumped the cursor forward — which silently hid every existing
       * thread for ever. Using the newest `updated_at` we handled also means a
       * thread that changes mid-batch is picked up on the next pass rather than
       * skipped, and a throw above leaves the cursor untouched so the window is
       * retried.
       */
      if (newestSeen !== null) {
        setNotificationCursor(new Date(newestSeen));
      }
      log.info(
        { threads: threads.length, recorded, cursor: newestSeen },
        'notification poll finished'
      );
    } catch (error) {
      this.lastError = errorMessage(error);
      log.error({ err: this.lastError }, 'notification poll failed');
    } finally {
      this.busy = false;
    }
  }

  private async handleThread(thread: GithubNotificationThread): Promise<boolean> {
    // Only pull requests matter here; issues and releases are ignored.
    if (thread.subjectType !== 'PullRequest') {
      return false;
    }
    const repo = this.resolveRepo(thread);
    if (!repo || repo.monitoring === 0) {
      return false;
    }
    if (getSettings().onlyMyPullRequests && !PERSONAL_REASONS.has(thread.reason)) {
      return false;
    }

    const prNumber = pullNumberFromApiUrl(thread.subjectUrl);
    if (prNumber === null) {
      return false;
    }

    /*
     * `reason` describes why you are subscribed to the thread, not what just
     * happened in it. Someone commenting on a pull request you were assigned
     * keeps `reason: assign`, so labelling purely from it reported new comments
     * as "Assigned to you".
     *
     * `latest_comment_url` is the newest activity, and its shape says which
     * kind: `/pulls/comments/` is a review comment on a line of the diff,
     * `/issues/comments/` is a comment on the conversation. When it points at
     * the pull request itself, nothing has been said and the reason stands.
     */
    const eventType = classifyThread(thread);

    /*
     * Skip anything on a pull request that is already merged or closed. It is
     * finished work: a comment landing on it afterwards is a remark, not a task,
     * and GitHub keeps the thread in the list either way.
     */
    if (await this.isFinished(repo, prNumber)) {
      log.debug({ repo: repo.full_name, prNumber }, 'pull request already finished, skipping');
      return false;
    }
    const created = await this.processor.recordFromPoller(repo, {
      repoName: thread.repoFullName,
      repoId: thread.repoId,
      prNumber,
      prTitle: thread.subjectTitle,
      eventType,
      message: `${describeEvent(eventType, thread.reason)}: ${truncate(thread.subjectTitle, 90)}`,
      url: `https://github.com/${thread.repoFullName}/pull/${prNumber}`,
      actor: null,
      // GitHub bumps `updated_at` on every new activity in the thread, so this
      // gives one notification per burst rather than one per poll.
      dedupeKey: `thread:${thread.id}:${thread.updatedAt}`,
    });
    return created !== null;
  }

  /**
   * Whether a pull request is already merged or closed.
   *
   * Fails open: if GitHub cannot be asked, the notification is kept. Losing a
   * real notification is worse than showing one about finished work.
   */
  private async isFinished(repo: RepoRow, prNumber: number): Promise<boolean> {
    const key = `${repo.full_name}#${prNumber}`;
    const cached = this.closedState.get(key);
    if (cached && Date.now() - cached.checkedAt < CLOSED_STATE_TTL_MS) {
      return cached.closed;
    }

    try {
      const detail = await this.github.getPullRequest(repo.owner, repo.name, prNumber);
      const closed = detail.state === 'closed' || detail.merged;
      this.closedState.set(key, { closed, checkedAt: Date.now() });
      return closed;
    } catch (error) {
      log.debug({ key, err: errorMessage(error) }, 'could not check pull-request state');
      return false;
    }
  }

  private resolveRepo(thread: GithubNotificationThread): RepoRow | null {
    return findRepoByGithubId(thread.repoId) ?? findRepoByFullName(thread.repoFullName);
  }

  /* ---------------------------------------------------------------- */
  /* Pass 2: merge-conflict detection                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Conflicts have no event. The only source of truth is `mergeable` on the
   * single-PR endpoint, and GitHub computes it lazily, so this pass is
   * deliberately slow and low priority.
   */
  private async pollConflicts(): Promise<void> {
    if (!this.github.isReady) {
      return;
    }
    try {
      const settings = getSettings();
      const user = this.processor.user;
      if (!user) {
        return;
      }
      const repos = listMonitoredRepos();
      const graceMs = settings.conflictGraceHours * 3600_000;
      const now = Date.now();

      for (const repo of repos) {
        if (repo.filter_conflicts === 0) {
          continue;
        }
        try {
          const pulls = await this.github.listOpenPullRequests(
            repo.owner,
            repo.name,
            settings.onlyMyPullRequests ? user : undefined
          );

          for (const summary of pulls) {
            // Skip drafts and PRs that are still brand new: a conflict on a PR
            // opened ten minutes ago is not news, it is the author's job.
            if (summary.draft) {
              continue;
            }
            if (now - Date.parse(summary.createdAt) < graceMs) {
              continue;
            }

            const detail = await this.github.getPullRequest(repo.owner, repo.name, summary.number);
            if (detail.mergeable === null) {
              // GitHub is still computing it. Next pass will pick it up.
              continue;
            }

            const isDirty = detail.mergeable === false || detail.mergeableState === 'dirty';
            const wasDirty = this.conflictState.get(detail.id) ?? false;

            if (isDirty && !wasDirty) {
              await this.processor.recordConflict(repo, detail, false);
            } else if (!isDirty && wasDirty) {
              await this.processor.recordConflict(repo, detail, true);
            }
            this.conflictState.set(detail.id, isDirty);
          }

          markConflictScanned(repo.id);
        } catch (error) {
          log.warn({ repo: repo.full_name, err: errorMessage(error) }, 'conflict scan failed');
        }
      }
      log.debug({ repos: repos.length }, 'conflict scan finished');
    } catch (error) {
      this.lastError = errorMessage(error);
      log.error({ err: this.lastError }, 'conflict poll failed');
    }
  }

  private async prune(): Promise<void> {
    try {
      const settings = getSettings();
      pruneOldNotifications(settings.retentionDays);
    } catch (error) {
      log.warn({ err: errorMessage(error) }, 'prune failed');
    }
  }
}

/** `https://api.github.com/repos/o/r/pulls/42` -> `42`. */
export function pullNumberFromApiUrl(url: string | null): number | null {
  if (!url) {
    return null;
  }
  const match = /\/pulls\/(\d+)(?:$|[/?])/.exec(url);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Works out what actually happened in a thread, not why you are watching it. */
export function classifyThread(thread: GithubNotificationThread): EventType {
  const latest = thread.latestCommentUrl;
  if (latest && latest !== thread.subjectUrl) {
    if (latest.includes('/pulls/comments/')) {
      return 'pr_review_comment';
    }
    if (latest.includes('/issues/comments/')) {
      return 'pr_comment';
    }
  }
  return REASON_TO_EVENT[thread.reason] ?? 'pr_comment';
}

/** Headline for a polled thread: what happened, falling back to why you see it. */
function describeEvent(eventType: EventType, reason: string): string {
  switch (eventType) {
    case 'pr_comment':
      return reason === 'mention' || reason === 'team_mention'
        ? 'New comment mentioning you'
        : 'New comment';
    case 'pr_review_comment':
      return 'New review comment';
    case 'review_requested':
      return 'Review requested';
    case 'pr_assigned':
      return 'Assigned to you';
    case 'pr_closed':
      return 'State changed';
    default:
      return describeReason(reason);
  }
}

function describeReason(reason: string): string {
  switch (reason) {
    case 'author':
      return 'Activity on your pull request';
    case 'comment':
      return 'New comment';
    case 'mention':
      return 'You were mentioned';
    case 'team_mention':
      return 'Your team was mentioned';
    case 'review_requested':
      return 'Review requested';
    case 'assign':
      return 'Assigned to you';
    case 'state_change':
      return 'State changed';
    case 'ci_activity':
      return 'CI activity';
    default:
      return 'Update';
  }
}
