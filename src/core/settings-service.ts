import type { AppSettings, AppSettingsUpdate } from '../shared/types';
import { type SettingsRow, toSettingsDto } from './db/rows';
import { db, nowIso, toSqlBool } from './db/sqlite';
import { secrets } from './secrets';

/**
 * Reads and writes the single settings row. Secrets never live here; the DTO
 * only exposes booleans saying whether they exist in the keyring.
 */

/** Maps DTO fields to columns, and converts the value on the way in. */
const COLUMN_MAP: Readonly<
  Record<keyof AppSettingsUpdate, [column: string, encode: (value: never) => unknown]>
> = {
  webhookPort: ['webhook_port', (v: number) => v],
  controlPort: ['control_port', (v: number) => v],
  publicWebhookUrl: ['public_webhook_url', (v: string | null) => v],
  pollIntervalSeconds: ['poll_interval_seconds', (v: number) => v],
  conflictPollIntervalSeconds: ['conflict_poll_interval_seconds', (v: number) => v],
  conflictGraceHours: ['conflict_grace_hours', (v: number) => v],
  notificationsEnabled: ['notifications_enabled', (v: boolean) => toSqlBool(v)],
  paused: ['paused', (v: boolean) => toSqlBool(v)],
  soundEnabled: ['sound_enabled', (v: boolean) => toSqlBool(v)],
  onlyMyPullRequests: ['only_my_pull_requests', (v: boolean) => toSqlBool(v)],
  startMinimized: ['start_minimized', (v: boolean) => toSqlBool(v)],
  retentionDays: ['retention_days', (v: number) => v],
  theme: ['theme', (v: string) => v],
  onboardingCompleted: ['onboarding_completed', (v: boolean) => toSqlBool(v)],
};

/** Bounds that keep a bad value from disabling polling or hammering GitHub. */
const CLAMPS: Partial<Record<keyof AppSettingsUpdate, [min: number, max: number]>> = {
  webhookPort: [1, 65535],
  controlPort: [1, 65535],
  pollIntervalSeconds: [30, 86400],
  conflictPollIntervalSeconds: [300, 86400],
  conflictGraceHours: [0, 720],
  retentionDays: [0, 3650],
};

/** Returns the settings row, creating it with defaults on first run. */
export function getSettingsRow(): SettingsRow {
  const connection = db.connection;
  const existing = connection.prepare('SELECT * FROM settings WHERE id = 1').get() as
    | SettingsRow
    | undefined;
  if (existing) {
    return existing;
  }
  const now = nowIso();
  connection
    .prepare('INSERT INTO settings (id, created_at, updated_at) VALUES (1, ?, ?)')
    .run(now, now);
  return connection.prepare('SELECT * FROM settings WHERE id = 1').get() as SettingsRow;
}

export function getSettings(): AppSettings {
  return toSettingsDto(getSettingsRow(), {
    hasToken: secrets.hasToken(),
    hasWebhookSecret: secrets.hasWebhookSecret(),
  });
}

/** Applies a partial update. Unknown keys are ignored, numbers are clamped. */
export function updateSettings(update: AppSettingsUpdate): AppSettings {
  getSettingsRow(); // ensure the row exists before updating it

  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [key, raw] of Object.entries(update) as Array<[keyof AppSettingsUpdate, unknown]>) {
    const mapping = COLUMN_MAP[key];
    if (!mapping || raw === undefined) {
      continue;
    }
    let value = raw;
    const clamp = CLAMPS[key];
    if (clamp && typeof value === 'number') {
      if (!Number.isFinite(value)) {
        continue;
      }
      value = Math.min(Math.max(Math.round(value), clamp[0]), clamp[1]);
    }
    const [column, encode] = mapping;
    assignments.push(`${column} = ?`);
    values.push((encode as (input: unknown) => unknown)(value));
  }

  if (assignments.length > 0) {
    assignments.push('updated_at = ?');
    values.push(nowIso());
    db.connection
      .prepare(`UPDATE settings SET ${assignments.join(', ')} WHERE id = 1`)
      .run(...values);
  }

  return getSettings();
}

/** Stores the GitHub login the token belongs to. */
export function setAuthenticatedUser(login: string | null): void {
  getSettingsRow();
  db.connection
    .prepare('UPDATE settings SET user_id = ?, updated_at = ? WHERE id = 1')
    .run(login, nowIso());
}

/** Moves the `?since=` cursor used by the notifications poller. */
export function setNotificationCursor(at: Date): void {
  getSettingsRow();
  db.connection
    .prepare('UPDATE settings SET last_notification_sync_at = ?, updated_at = ? WHERE id = 1')
    .run(at.toISOString(), nowIso());
}

/**
 * Forgets how far the poller has read.
 *
 * Called when a repository is switched on: its existing threads are older than
 * the cursor, so without this they would never be looked at again and the repo
 * would stay silent until something new happened in it.
 */
export function clearNotificationCursor(): void {
  getSettingsRow();
  db.connection
    .prepare('UPDATE settings SET last_notification_sync_at = NULL, updated_at = ? WHERE id = 1')
    .run(nowIso());
}

export function getNotificationCursor(): Date | null {
  const value = getSettingsRow().last_notification_sync_at;
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
