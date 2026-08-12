import { Octokit } from '@octokit/rest';
import { GITHUB_API_BASE } from '../shared/constants';
import { AppError, errorMessage, errorStatus } from '../shared/errors';
import {
  type GithubNotificationThread,
  type GithubUser,
  type MergeableState,
  type PullRequestSnapshot,
  type RepoPermission,
  SUBSCRIBED_WEBHOOK_EVENTS,
  type TokenValidation,
} from '../shared/types';
import { childLogger } from './logger';
import { RateLimitQueue } from './rate-limit-queue';

const log = childLogger('github-api');

/** Scopes the app cannot work without. */
export const REQUIRED_SCOPES = ['repo', 'notifications'] as const;

/** Shape of a repository as returned by `GET /user/repos`. */
interface RestRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string;
  html_url: string;
  description: string | null;
  owner: { login: string };
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
}

export interface WebhookRef {
  id: number;
  url: string;
  active: boolean;
  events: string[];
}

/**
 * Typed facade over Octokit.
 *
 * Every call goes through the rate-limit queue and every response feeds its
 * headers back into that queue, so quota handling is automatic rather than
 * something each call site has to remember.
 */
export class GithubApi {
  private octokit: Octokit | null = null;
  private token: string | null = null;
  private cachedUser: GithubUser | null = null;
  readonly queue = new RateLimitQueue({ concurrency: 2, minIntervalMs: 120 });

  get isReady(): boolean {
    return this.octokit !== null;
  }

  get user(): GithubUser | null {
    return this.cachedUser;
  }

  setToken(token: string | null): void {
    this.token = token;
    this.cachedUser = null;
    if (!token) {
      this.octokit = null;
      this.queue.clear('token removed');
      return;
    }
    this.octokit = new Octokit({
      auth: token,
      baseUrl: GITHUB_API_BASE,
      userAgent: 'github-notifier/1.0',
      request: { timeout: 15000 },
    });
    this.attachHooks(this.octokit);
  }

  private attachHooks(octokit: Octokit): void {
    octokit.hook.after('request', (response) => {
      this.queue.observeHeaders(response.headers as Record<string, string | number | undefined>);
    });
    octokit.hook.error('request', (error) => {
      const status = errorStatus(error);
      if (status === 403 || status === 429) {
        const headers =
          typeof error === 'object' && error !== null && 'response' in error
            ? ((error as { response?: { headers?: Record<string, string> } }).response?.headers ??
              {})
            : {};
        const retryAfter = headers['retry-after'];
        this.queue.backOff(retryAfter ? Number(retryAfter) : null, `HTTP ${status}`);
      }
      throw error;
    });
  }

  private client(): Octokit {
    if (!this.octokit) {
      throw new AppError('NO_TOKEN', 'No GitHub token configured. Add one in Settings.');
    }
    return this.octokit;
  }

  /* ---------------------------------------------------------------- */
  /* Auth                                                              */
  /* ---------------------------------------------------------------- */

  /** Checks the token works and reports which required scopes are missing. */
  async validateToken(token?: string): Promise<TokenValidation> {
    const candidate = token ?? this.token;
    if (!candidate) {
      return {
        valid: false,
        user: null,
        scopes: [],
        missingScopes: [...REQUIRED_SCOPES],
        error: 'No token provided',
      };
    }

    const probe = token ? new Octokit({ auth: token, baseUrl: GITHUB_API_BASE }) : this.client();

    try {
      const response = await this.queue.add('validateToken', () =>
        probe.rest.users.getAuthenticated()
      );
      const scopeHeader = response.headers['x-oauth-scopes'];
      const scopes =
        typeof scopeHeader === 'string' && scopeHeader.length > 0
          ? scopeHeader.split(',').map((scope) => scope.trim())
          : [];
      // Fine-grained tokens report no scopes at all; treat that as "unknown but
      // usable" rather than failing, since the call itself succeeded.
      const missingScopes =
        scopes.length === 0
          ? []
          : REQUIRED_SCOPES.filter((needed) => !scopes.includes(needed)).map(String);

      const user: GithubUser = {
        login: response.data.login,
        id: response.data.id,
        name: response.data.name ?? null,
        avatarUrl: response.data.avatar_url,
        htmlUrl: response.data.html_url,
      };
      if (!token) {
        this.cachedUser = user;
      }
      return { valid: true, user, scopes, missingScopes, error: null };
    } catch (error) {
      const status = errorStatus(error);
      return {
        valid: false,
        user: null,
        scopes: [],
        missingScopes: [...REQUIRED_SCOPES],
        error:
          status === 401
            ? 'Token rejected by GitHub (401). It may be expired or revoked.'
            : errorMessage(error),
      };
    }
  }

  async getAuthenticatedUser(): Promise<GithubUser> {
    if (this.cachedUser) {
      return this.cachedUser;
    }
    const result = await this.validateToken();
    if (!result.valid || !result.user) {
      throw new AppError('BAD_TOKEN', result.error ?? 'Token validation failed');
    }
    this.cachedUser = result.user;
    return result.user;
  }

  /* ---------------------------------------------------------------- */
  /* Repositories                                                      */
  /* ---------------------------------------------------------------- */

  /** Every repo the token can see, across personal and org accounts. */
  async listRepositories(): Promise<RestRepository[]> {
    const octokit = this.client();
    return this.queue.add(
      'listRepositories',
      () =>
        octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
          per_page: 100,
          sort: 'pushed',
          affiliation: 'owner,collaborator,organization_member',
        }) as Promise<RestRepository[]>,
      5
    );
  }

  /** Open pull requests in a repo, optionally narrowed to one author. */
  async listOpenPullRequests(
    owner: string,
    repo: string,
    authorLogin?: string
  ): Promise<PullRequestSnapshot[]> {
    const octokit = this.client();
    const pulls = await this.queue.add(
      `listOpenPullRequests:${owner}/${repo}`,
      () =>
        octokit.paginate(octokit.rest.pulls.list, {
          owner,
          repo,
          state: 'open',
          per_page: 100,
          sort: 'updated',
          direction: 'desc',
        }) as Promise<unknown[]>
    );

    const snapshots = pulls.map((pull) => toSnapshotFromList(pull, `${owner}/${repo}`));
    return authorLogin
      ? snapshots.filter((snapshot) => snapshot.authorLogin === authorLogin)
      : snapshots;
  }

  /**
   * Full PR detail. Only this endpoint returns `mergeable`, and GitHub computes
   * it lazily: the first call after a push returns `null` while the background
   * job runs, so callers must be ready to retry.
   */
  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequestSnapshot> {
    const octokit = this.client();
    const response = await this.queue.add(`getPullRequest:${owner}/${repo}#${number}`, () =>
      octokit.rest.pulls.get({ owner, repo, pull_number: number })
    );
    const pull = response.data;
    return {
      id: pull.id,
      number: pull.number,
      title: pull.title,
      htmlUrl: pull.html_url,
      state: pull.state === 'closed' ? 'closed' : 'open',
      draft: pull.draft ?? false,
      merged: pull.merged ?? false,
      mergeable: pull.mergeable ?? null,
      mergeableState: (pull.mergeable_state ?? 'unknown') as MergeableState,
      authorLogin: pull.user?.login ?? 'unknown',
      authorAvatarUrl: pull.user?.avatar_url ?? '',
      baseRef: pull.base.ref,
      headRef: pull.head.ref,
      headSha: pull.head.sha,
      repoFullName: `${owner}/${repo}`,
      repoId: pull.base.repo.id,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
    };
  }

  /** Aggregate check status for a commit. Used for the optional CI events. */
  async getCombinedCheckConclusion(
    owner: string,
    repo: string,
    ref: string
  ): Promise<'success' | 'failure' | 'pending' | 'none'> {
    const octokit = this.client();
    const response = await this.queue.add(`checkSuites:${owner}/${repo}@${ref}`, () =>
      octokit.rest.checks.listForRef({ owner, repo, ref, per_page: 100 })
    );
    const runs = response.data.check_runs;
    if (runs.length === 0) {
      return 'none';
    }
    if (runs.some((run) => run.status !== 'completed')) {
      return 'pending';
    }
    const bad = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);
    return runs.some((run) => run.conclusion && bad.has(run.conclusion)) ? 'failure' : 'success';
  }

  /* ---------------------------------------------------------------- */
  /* Notifications API (poller source)                                 */
  /* ---------------------------------------------------------------- */

  /** `GET /notifications`. Cheap: one request covers every repo at once. */
  async listNotifications(since: Date | null): Promise<GithubNotificationThread[]> {
    const octokit = this.client();
    const response = await this.queue.add(
      'listNotifications',
      () =>
        octokit.rest.activity.listNotificationsForAuthenticatedUser({
          all: false,
          participating: true,
          per_page: 50,
          ...(since ? { since: since.toISOString() } : {}),
        }),
      1
    );

    return response.data.map((thread) => ({
      id: thread.id,
      unread: thread.unread,
      reason: thread.reason,
      updatedAt: thread.updated_at,
      subjectTitle: thread.subject.title,
      subjectType: thread.subject.type,
      subjectUrl: thread.subject.url ?? null,
      latestCommentUrl: thread.subject.latest_comment_url ?? null,
      repoFullName: thread.repository.full_name,
      repoId: thread.repository.id,
    }));
  }

  /* ---------------------------------------------------------------- */
  /* Webhooks                                                          */
  /* ---------------------------------------------------------------- */

  async listWebhooks(owner: string, repo: string): Promise<WebhookRef[]> {
    const octokit = this.client();
    const response = await this.queue.add(`listWebhooks:${owner}/${repo}`, () =>
      octokit.rest.repos.listWebhooks({ owner, repo, per_page: 100 })
    );
    return response.data.map((hook) => ({
      id: hook.id,
      url: typeof hook.config.url === 'string' ? hook.config.url : '',
      active: hook.active,
      events: hook.events,
    }));
  }

  /** Creates the webhook, or updates the existing one that points at our URL. */
  async upsertWebhook(
    owner: string,
    repo: string,
    payloadUrl: string,
    secret: string
  ): Promise<WebhookRef> {
    const octokit = this.client();
    const existing = (await this.listWebhooks(owner, repo)).find((hook) => hook.url === payloadUrl);

    const config = {
      url: payloadUrl,
      content_type: 'json' as const,
      secret,
      insecure_ssl: '0' as const,
    };

    if (existing) {
      const updated = await this.queue.add(`updateWebhook:${owner}/${repo}`, () =>
        octokit.rest.repos.updateWebhook({
          owner,
          repo,
          hook_id: existing.id,
          config,
          events: [...SUBSCRIBED_WEBHOOK_EVENTS],
          active: true,
        })
      );
      return {
        id: updated.data.id,
        url: payloadUrl,
        active: updated.data.active,
        events: updated.data.events,
      };
    }

    const created = await this.queue.add(`createWebhook:${owner}/${repo}`, () =>
      octokit.rest.repos.createWebhook({
        owner,
        repo,
        name: 'web',
        config,
        events: [...SUBSCRIBED_WEBHOOK_EVENTS],
        active: true,
      })
    );
    log.info({ repo: `${owner}/${repo}`, hookId: created.data.id }, 'webhook created');
    return {
      id: created.data.id,
      url: payloadUrl,
      active: created.data.active,
      events: created.data.events,
    };
  }

  async deleteWebhook(owner: string, repo: string, hookId: number): Promise<void> {
    const octokit = this.client();
    try {
      await this.queue.add(`deleteWebhook:${owner}/${repo}`, () =>
        octokit.rest.repos.deleteWebhook({ owner, repo, hook_id: hookId })
      );
    } catch (error) {
      // Already gone is a success from the caller's point of view.
      if (errorStatus(error) !== 404) {
        throw error;
      }
    }
  }
}

/** Highest permission GitHub reports for the authenticated user. */
export function permissionFromRest(repo: RestRepository): RepoPermission {
  const permissions = repo.permissions;
  if (!permissions) {
    return 'read';
  }
  if (permissions.admin) {
    return 'admin';
  }
  if (permissions.maintain) {
    return 'maintain';
  }
  if (permissions.push) {
    return 'write';
  }
  if (permissions.triage) {
    return 'triage';
  }
  return 'read';
}

export type { RestRepository };

/**
 * `GET /pulls` omits `mergeable`, so list-derived snapshots always report
 * `null` there. The conflict poller re-fetches each PR individually.
 */
function toSnapshotFromList(raw: unknown, repoFullName: string): PullRequestSnapshot {
  const pull = raw as {
    id: number;
    number: number;
    title: string;
    html_url: string;
    state: string;
    draft?: boolean;
    user?: { login?: string; avatar_url?: string };
    base: { ref: string; repo: { id: number } };
    head: { ref: string; sha: string };
    created_at: string;
    updated_at: string;
  };
  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    htmlUrl: pull.html_url,
    state: pull.state === 'closed' ? 'closed' : 'open',
    draft: pull.draft ?? false,
    merged: false,
    mergeable: null,
    mergeableState: 'unknown',
    authorLogin: pull.user?.login ?? 'unknown',
    authorAvatarUrl: pull.user?.avatar_url ?? '',
    baseRef: pull.base.ref,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    repoFullName,
    repoId: pull.base.repo.id,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
  };
}

export const github = new GithubApi();
