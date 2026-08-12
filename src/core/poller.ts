import { errorMessage } from '../shared/errors';
import { truncate } from '../shared/format';
import type { EventType, GithubNotificationThread } from '../shared/types';
import type { EventProcessor } from './event-processor';
import type { GithubApi } from './github-api';
import { childLogger } from './logger';
import type { RepoDocument } from './models';
import { pruneOldNotifications } from './notification-service';
import { findRepoByFullName, findRepoByGithubId, listMonitoredRepos } from './repo-service';
import { getSettings, setNotificationCursor } from './settings-service';

const log = childLogger('poller');

/**
 * Polling engine.
 *
 * This is the part that actually works on a normal desktop, because GitHub
 * cannot POST a webhook to a machine behind NAT. It also covers the one thing
 * webhooks can never report: a pull request that has *become* unmergeable
 * because something else landed on the base branch.
 */

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
    const settings = await getSettings();
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
      const since = await this.readCursor();
      const threads = await this.github.listNotifications(since);
      this.lastPollAt = new Date();
      this.lastError = null;

      if (threads.length === 0) {
        log.debug('no new GitHub notification threads');
        return;
      }

      let recorded = 0;
      for (const thread of threads) {
        const created = await this.handleThread(thread);
        if (created) {
          recorded += 1;
        }
      }
      await setNotificationCursor(this.lastPollAt);
      log.info({ threads: threads.length, recorded }, 'notification poll finished');
    } catch (error) {
      this.lastError = errorMessage(error);
      log.error({ err: this.lastError }, 'notification poll failed');
    } finally {
      this.busy = false;
    }
  }

  private async readCursor(): Promise<Date | null> {
    const { SettingsModel } = await import('./models');
    const doc = await SettingsModel.findOne({ key: 'global' }).select('lastNotificationSyncAt');
    return doc?.lastNotificationSyncAt ?? null;
  }

  private async handleThread(thread: GithubNotificationThread): Promise<boolean> {
    // Only pull requests matter here; issues and releases are ignored.
    if (thread.subjectType !== 'PullRequest') {
      return false;
    }
    const repo = await this.resolveRepo(thread);
    if (!repo || !repo.monitoring) {
      return false;
    }

    const prNumber = pullNumberFromApiUrl(thread.subjectUrl);
    if (prNumber === null) {
      return false;
    }

    const eventType = REASON_TO_EVENT[thread.reason] ?? 'pr_comment';
    const created = await this.processor.recordFromPoller(repo, {
      repoName: thread.repoFullName,
      repoId: thread.repoId,
      prNumber,
      prTitle: thread.subjectTitle,
      eventType,
      message: `${describeReason(thread.reason)}: ${truncate(thread.subjectTitle, 90)}`,
      url: `https://github.com/${thread.repoFullName}/pull/${prNumber}`,
      actor: null,
      // GitHub bumps `updated_at` on every new activity in the thread, so this
      // gives one notification per burst rather than one per poll.
      dedupeKey: `thread:${thread.id}:${thread.updatedAt}`,
    });
    return created !== null;
  }

  private async resolveRepo(thread: GithubNotificationThread): Promise<RepoDocument | null> {
    return (await findRepoByGithubId(thread.repoId)) ?? findRepoByFullName(thread.repoFullName);
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
      const settings = await getSettings();
      const user = this.processor.user;
      if (!user) {
        return;
      }
      const repos = await listMonitoredRepos();
      const graceMs = settings.conflictGraceHours * 3600_000;
      const now = Date.now();

      for (const repo of repos) {
        if (!repo.eventFilters.conflicts) {
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

          repo.lastConflictScanAt = new Date();
          await repo.save();
        } catch (error) {
          log.warn({ repo: repo.fullName, err: errorMessage(error) }, 'conflict scan failed');
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
      const settings = await getSettings();
      await pruneOldNotifications(settings.retentionDays);
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
