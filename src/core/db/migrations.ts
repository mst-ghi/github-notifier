import type { Database } from 'better-sqlite3';

/**
 * Schema migrations, applied in order and tracked with SQLite's own
 * `user_version` pragma. Never edit a migration that has shipped: add a new
 * one, or an existing install will silently disagree with a fresh one.
 */

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) => {
      db.exec(`
        -- Single-row table. The CHECK makes a second row impossible.
        CREATE TABLE settings (
          id                             INTEGER PRIMARY KEY CHECK (id = 1),
          user_id                        TEXT,
          webhook_port                   INTEGER NOT NULL DEFAULT 8014,
          control_port                   INTEGER NOT NULL DEFAULT 8015,
          public_webhook_url             TEXT,
          poll_interval_seconds          INTEGER NOT NULL DEFAULT 60,
          conflict_poll_interval_seconds INTEGER NOT NULL DEFAULT 900,
          conflict_grace_hours           INTEGER NOT NULL DEFAULT 24,
          notifications_enabled          INTEGER NOT NULL DEFAULT 1,
          paused                         INTEGER NOT NULL DEFAULT 0,
          sound_enabled                  INTEGER NOT NULL DEFAULT 0,
          only_my_pull_requests          INTEGER NOT NULL DEFAULT 1,
          start_minimized                INTEGER NOT NULL DEFAULT 0,
          retention_days                 INTEGER NOT NULL DEFAULT 7,
          theme                          TEXT    NOT NULL DEFAULT 'system',
          last_notification_sync_at      TEXT,
          created_at                     TEXT    NOT NULL,
          updated_at                     TEXT    NOT NULL
        );

        CREATE TABLE repos (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          github_id             INTEGER NOT NULL UNIQUE,
          full_name             TEXT    NOT NULL,
          owner                 TEXT    NOT NULL,
          name                  TEXT    NOT NULL,
          is_private            INTEGER NOT NULL DEFAULT 0,
          archived              INTEGER NOT NULL DEFAULT 0,
          default_branch        TEXT    NOT NULL DEFAULT 'main',
          html_url              TEXT    NOT NULL,
          description           TEXT,
          permission            TEXT    NOT NULL DEFAULT 'read',
          monitoring            INTEGER NOT NULL DEFAULT 0,
          -- One column per switch rather than a JSON blob, so the poller can
          -- filter in SQL instead of loading every repo to check a flag.
          filter_comments       INTEGER NOT NULL DEFAULT 1,
          filter_reviews        INTEGER NOT NULL DEFAULT 1,
          filter_merges         INTEGER NOT NULL DEFAULT 1,
          filter_conflicts      INTEGER NOT NULL DEFAULT 1,
          filter_checks         INTEGER NOT NULL DEFAULT 0,
          filter_assignments    INTEGER NOT NULL DEFAULT 1,
          webhook_id            INTEGER,
          webhook_status        TEXT    NOT NULL DEFAULT 'absent',
          webhook_last_error    TEXT,
          last_synced_at        TEXT,
          last_event_at         TEXT,
          last_conflict_scan_at TEXT,
          created_at            TEXT    NOT NULL,
          updated_at            TEXT    NOT NULL
        );

        CREATE INDEX idx_repos_monitoring ON repos (monitoring);
        CREATE INDEX idx_repos_full_name  ON repos (full_name);

        CREATE TABLE notifications (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id          TEXT    NOT NULL,
          repo_name        TEXT    NOT NULL,
          repo_id          INTEGER,
          pr_number        INTEGER,
          pr_title         TEXT,
          event_type       TEXT    NOT NULL,
          severity         TEXT    NOT NULL DEFAULT 'info',
          source           TEXT    NOT NULL DEFAULT 'poller',
          message          TEXT    NOT NULL,
          detail           TEXT,
          url              TEXT    NOT NULL,
          actor            TEXT,
          actor_avatar_url TEXT,
          -- Stable per real-world event so the webhook and the poller cannot
          -- both record it. The UNIQUE constraint is the dedupe mechanism.
          dedupe_key       TEXT    NOT NULL UNIQUE,
          is_read          INTEGER NOT NULL DEFAULT 0,
          is_delivered     INTEGER NOT NULL DEFAULT 0,
          created_at       TEXT    NOT NULL,
          read_at          TEXT
        );

        CREATE INDEX idx_notifications_created ON notifications (created_at DESC);
        CREATE INDEX idx_notifications_unread  ON notifications (is_read, created_at DESC);
        CREATE INDEX idx_notifications_repo    ON notifications (repo_name, created_at DESC);
        CREATE INDEX idx_notifications_event   ON notifications (event_type, created_at DESC);
      `);
    },
  },
  {
    version: 2,
    name: 'cache open pull-request counts per repository',
    up: (db) => {
      db.exec(`
        -- Cached so the sidebar total renders instantly instead of waiting on
        -- one GitHub round-trip per monitored repository.
        ALTER TABLE repos ADD COLUMN open_pr_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE repos ADD COLUMN open_pr_synced_at TEXT;
      `);
    },
  },
  {
    version: 3,
    name: 'remember whether setup was completed',
    up: (db) => {
      db.exec(`
        ALTER TABLE settings ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
      `);
      // An existing install already has a token, so it has effectively been
      // through setup: do not send those users back to a welcome screen.
      db.exec(`
        UPDATE settings SET onboarding_completed = 1 WHERE user_id IS NOT NULL;
      `);
    },
  },
];

export const LATEST_VERSION: number =
  MIGRATIONS.length > 0 ? Math.max(...MIGRATIONS.map((m) => m.version)) : 0;
