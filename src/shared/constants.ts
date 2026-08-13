/**
 * Values shared by every process (daemon, Electron main, renderer).
 * Renderer-safe: this module must never import Node built-ins.
 */

export const APP_ID = 'dev.mostafa.github-notifier' as const;
export const APP_NAME = 'GitHub Notifier' as const;

/** Directory name used under $XDG_CONFIG_HOME (or ~/.config). */
export const CONFIG_DIR_NAME = 'github-notifier' as const;

/** Port the GitHub webhook receiver listens on. */
export const DEFAULT_WEBHOOK_PORT = 8014 as const;

/** Loopback-only control API the Electron app uses to talk to the daemon. */
export const DEFAULT_CONTROL_PORT = 8015 as const;
export const CONTROL_HOST = '127.0.0.1' as const;

/** SQLite file name, created under $XDG_DATA_HOME/github-notifier. */
export const DATABASE_FILE_NAME = 'github-notifier.db' as const;

/** Poll cadences, in seconds. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 60 as const;
export const DEFAULT_CONFLICT_POLL_INTERVAL_SECONDS = 900 as const;

/** A PR must sit unmerged this long before a conflict is worth reporting. */
export const DEFAULT_CONFLICT_GRACE_HOURS = 24 as const;

/**
 * Notifications older than this are deleted, read or not. A week is long
 * enough to catch up after a holiday and short enough that the file stays tiny.
 */
export const DEFAULT_RETENTION_DAYS = 7 as const;

/** Keyring entries. */
export const KEYRING_SERVICE = 'github-notifier' as const;
export const KEYRING_ACCOUNT_TOKEN = 'github-token' as const;
export const KEYRING_ACCOUNT_WEBHOOK_SECRET = 'webhook-secret' as const;

/** Stop issuing API calls when fewer than this many core requests remain. */
export const RATE_LIMIT_RESERVE = 100 as const;

export const GITHUB_API_BASE = 'https://api.github.com' as const;

/** Every event kind the app can raise. Order matters only for UI listings. */
export const EVENT_TYPES = [
  'pr_comment',
  'pr_review_comment',
  'pr_review',
  'pr_merged',
  'pr_closed',
  'pr_conflict',
  'pr_conflict_resolved',
  'check_failed',
  'check_succeeded',
  'pr_assigned',
  'review_requested',
  'system',
] as const;

export const REPO_PERMISSION_LEVELS = ['read', 'triage', 'write', 'maintain', 'admin'] as const;
