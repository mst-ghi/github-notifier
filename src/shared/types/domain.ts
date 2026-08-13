import type { EVENT_TYPES, REPO_PERMISSION_LEVELS } from '../constants';

/** One of the notification kinds the app can raise. */
export type EventType = (typeof EVENT_TYPES)[number];

/** GitHub repository permission level for the authenticated user. */
export type RepoPermission = (typeof REPO_PERMISSION_LEVELS)[number];

/** How urgent a notification is. Drives the desktop-notification urgency hint. */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/** Which subsystem produced the notification. */
export type NotificationSource = 'webhook' | 'poller' | 'manual' | 'system';

/** Whether the webhook the app installed on a repo is healthy. */
export type WebhookStatus = 'absent' | 'active' | 'inactive' | 'error' | 'unmanaged';

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

/** Per-repository switches for which events raise a notification. */
export interface RepoEventFilters {
  comments: boolean;
  reviews: boolean;
  merges: boolean;
  conflicts: boolean;
  checks: boolean;
  assignments: boolean;
}

/** A repository the user can see, plus this app's monitoring settings for it. */
export interface Repo {
  /** Database row id, rendered as a string. */
  id: string;
  /** Numeric GitHub repository id. Stable across renames. */
  githubId: number;
  /** `owner/name`. */
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  htmlUrl: string;
  description: string | null;
  permission: RepoPermission;
  /** True when this app should raise notifications for the repo. */
  monitoring: boolean;
  eventFilters: RepoEventFilters;
  /** Numeric id of the webhook this app created, if any. */
  webhookId: number | null;
  webhookStatus: WebhookStatus;
  webhookLastError: string | null;
  lastSyncedAt: string | null;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields a client is allowed to change on a repo. */
export interface RepoUpdate {
  monitoring?: boolean;
  eventFilters?: Partial<RepoEventFilters>;
}

/* ------------------------------------------------------------------ */
/* Notification                                                        */
/* ------------------------------------------------------------------ */

/** A single stored notification. Mirrors the `notifications` table. */
export interface AppNotification {
  id: string;
  /** GitHub login of the account this notifier runs as. */
  userId: string;
  repoName: string;
  repoId: number | null;
  prNumber: number | null;
  prTitle: string | null;
  eventType: EventType;
  severity: NotificationSeverity;
  source: NotificationSource;
  /** Short one-line body shown in the desktop toast. */
  message: string;
  /** Extra detail shown only inside the app. */
  detail: string | null;
  /** Opened in the browser when the notification is clicked. */
  url: string;
  /** GitHub login of whoever triggered the event. */
  actor: string | null;
  actorAvatarUrl: string | null;
  /** Stable key used to drop duplicate deliveries (webhook + poller overlap). */
  dedupeKey: string;
  isRead: boolean;
  /** Set once the desktop toast has actually been shown. */
  isDelivered: boolean;
  createdAt: string;
  readAt: string | null;
}

/** Query shape for the notification list. All fields optional. */
export interface NotificationQuery {
  search?: string;
  repoName?: string;
  eventTypes?: EventType[];
  isRead?: boolean;
  /** ISO date string, inclusive lower bound on `createdAt`. */
  since?: string;
  /** ISO date string, exclusive upper bound on `createdAt`. */
  until?: string;
  limit?: number;
  skip?: number;
  sort?: 'newest' | 'oldest';
}

export interface NotificationPage {
  items: AppNotification[];
  total: number;
  unread: number;
  limit: number;
  skip: number;
}

/** Housekeeping figures for the notification history. */
export interface NotificationStats {
  total: number;
  unread: number;
  /** How many rows the current retention setting would delete right now. */
  prunable: number;
  oldestAt: string | null;
  /** Size of the SQLite file on disk. */
  databaseBytes: number;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Everything in the `settings` table except the token, which lives in the keyring. */
export interface AppSettings {
  /** GitHub login of the account the token belongs to. */
  userId: string | null;
  webhookPort: number;
  controlPort: number;
  /** Public https URL GitHub should POST to. Null disables webhook auto-registration. */
  publicWebhookUrl: string | null;
  pollIntervalSeconds: number;
  conflictPollIntervalSeconds: number;
  conflictGraceHours: number;
  /** Global kill switch for desktop toasts. History is still recorded. */
  notificationsEnabled: boolean;
  /** Suppress toasts but keep recording. Set from the tray "Pause" item. */
  paused: boolean;
  soundEnabled: boolean;
  /** Only notify about PRs the user authored. */
  onlyMyPullRequests: boolean;
  startMinimized: boolean;
  /** Delete notifications older than this. 0 disables pruning. */
  retentionDays: number;
  theme: 'light' | 'dark' | 'system';
  /** True once a token has been stored in the keyring. Never contains the token. */
  hasToken: boolean;
  /** True once a webhook secret has been stored in the keyring. */
  hasWebhookSecret: boolean;
  updatedAt: string;
}

/** Fields a client may change. `hasToken`/`userId` are derived, not settable. */
export type AppSettingsUpdate = Partial<
  Omit<AppSettings, 'hasToken' | 'hasWebhookSecret' | 'userId' | 'updatedAt'>
>;

/* ------------------------------------------------------------------ */
/* Runtime status                                                      */
/* ------------------------------------------------------------------ */

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  /** ISO timestamp of the next quota reset. */
  resetAt: string | null;
  /** Number of calls waiting in the queue. */
  queued: number;
}

export interface DaemonStatus {
  /** False when the control API could not be reached at all. */
  reachable: boolean;
  version: string;
  /** Seconds since the daemon started. */
  uptimeSeconds: number;
  paused: boolean;
  /** Whether the *daemon's* database handle is open. */
  dbConnected: boolean;
  webhookListening: boolean;
  webhookPort: number;
  pollerRunning: boolean;
  lastPollAt: string | null;
  lastPollError: string | null;
  lastWebhookAt: string | null;
  authenticatedAs: string | null;
  rateLimit: RateLimitInfo | null;
  monitoredRepoCount: number;
}

/** Window rectangle in desktop coordinates, matching `Electron.Rectangle`. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GithubUser {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

/** What a release check found. Reporting only: the app never self-installs. */
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
  /** Direct link to the .deb asset, when the release has one. */
  downloadUrl: string | null;
  /** Release notes, as markdown. */
  notes: string | null;
  error: string | null;
}

/** Result of validating a token against the GitHub API. */
export interface TokenValidation {
  valid: boolean;
  user: GithubUser | null;
  /** OAuth scopes reported in the `x-oauth-scopes` response header. */
  scopes: string[];
  missingScopes: string[];
  error: string | null;
}
