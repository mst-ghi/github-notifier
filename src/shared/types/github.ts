import type {
  CheckRunEvent,
  CheckSuiteEvent,
  IssueCommentEvent,
  PingEvent,
  PullRequestEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
  PushEvent,
  Repository,
  User,
} from '@octokit/webhooks-types';

/**
 * `@octokit/webhooks-types` is types-only, so everything here is erased at
 * build time and is safe to import from the renderer.
 */

/** Webhook event names this app subscribes to. */
export const SUBSCRIBED_WEBHOOK_EVENTS = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'check_suite',
] as const;

export type SubscribedWebhookEvent = (typeof SUBSCRIBED_WEBHOOK_EVENTS)[number];

/**
 * Discriminated union of the payloads we actually handle. The `name` field is
 * taken from the `x-github-event` header, not from the body, so it is the only
 * safe discriminant.
 */
export type HandledWebhookDelivery =
  | { name: 'ping'; payload: PingEvent }
  | { name: 'push'; payload: PushEvent }
  | { name: 'pull_request'; payload: PullRequestEvent }
  | { name: 'pull_request_review'; payload: PullRequestReviewEvent }
  | { name: 'pull_request_review_comment'; payload: PullRequestReviewCommentEvent }
  | { name: 'issue_comment'; payload: IssueCommentEvent }
  | { name: 'check_suite'; payload: CheckSuiteEvent }
  | { name: 'check_run'; payload: CheckRunEvent };

export type HandledWebhookEventName = HandledWebhookDelivery['name'];

/** GitHub's own tri-state for whether a PR can be merged. */
export type MergeableState =
  | 'behind'
  | 'blocked'
  | 'clean'
  | 'dirty'
  | 'draft'
  | 'has_hooks'
  | 'unknown'
  | 'unstable';

/**
 * Normalised view of a pull request. Built from either the REST response or a
 * webhook payload so downstream code never branches on where it came from.
 */
export interface PullRequestSnapshot {
  id: number;
  number: number;
  title: string;
  htmlUrl: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  /** `null` when GitHub has not finished computing the merge commit yet. */
  mergeable: boolean | null;
  mergeableState: MergeableState;
  authorLogin: string;
  authorAvatarUrl: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  repoFullName: string;
  repoId: number;
  createdAt: string;
  updatedAt: string;
}

/** Minimal repo shape used when we only need identity. */
export interface RepoRef {
  id: number;
  fullName: string;
  owner: string;
  name: string;
}

export function toRepoRef(
  repository: Pick<Repository, 'id' | 'full_name' | 'name' | 'owner'>
): RepoRef {
  return {
    id: repository.id,
    fullName: repository.full_name,
    owner: repository.owner.login,
    name: repository.name,
  };
}

export function actorLogin(user: Pick<User, 'login'> | null | undefined): string | null {
  return user?.login ?? null;
}

/** Item returned by `GET /notifications`. Octokit types it loosely, so we narrow it. */
export interface GithubNotificationThread {
  id: string;
  unread: boolean;
  reason: string;
  updatedAt: string;
  subjectTitle: string;
  /** e.g. `PullRequest`, `Issue`, `CheckSuite`. */
  subjectType: string;
  /** API url of the subject, e.g. `.../pulls/42`. Null for some subject types. */
  subjectUrl: string | null;
  /** API url of the latest comment, when the subject has one. */
  latestCommentUrl: string | null;
  repoFullName: string;
  repoId: number;
}
