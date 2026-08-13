import { EVENT_SEVERITY } from '../shared/format';
import type {
  AppNotification,
  EventType,
  NotificationPage,
  NotificationQuery,
  NotificationSeverity,
  NotificationSource,
  NotificationStats,
} from '../shared/types';
import { type NotificationRow, toNotificationDto } from './db/rows';
import { db, escapeLike, nowIso, toSqlBool } from './db/sqlite';
import { childLogger } from './logger';

const log = childLogger('notifications');

/** Input accepted by `createNotification`. Severity defaults from event type. */
export interface NewNotification {
  userId: string;
  repoName: string;
  repoId?: number | null;
  prNumber?: number | null;
  prTitle?: string | null;
  eventType: EventType;
  severity?: NotificationSeverity;
  source: NotificationSource;
  message: string;
  detail?: string | null;
  url: string;
  actor?: string | null;
  actorAvatarUrl?: string | null;
  /** Must be stable for the same real-world event across webhook and poller. */
  dedupeKey: string;
}

const MAX_PAGE_SIZE = 200;

/**
 * Inserts a notification.
 *
 * Returns `null` when the event was already recorded, which is the normal case
 * whenever a repo has both a webhook and the poller enabled. `ON CONFLICT DO
 * NOTHING` against the unique `dedupe_key` does the work; callers use the null
 * to decide whether to raise a desktop toast.
 */
export function createNotification(input: NewNotification): AppNotification | null {
  const result = db.connection
    .prepare(
      `INSERT INTO notifications (
         user_id, repo_name, repo_id, pr_number, pr_title, event_type, severity,
         source, message, detail, url, actor, actor_avatar_url, dedupe_key,
         is_read, is_delivered, created_at, read_at
       ) VALUES (
         @userId, @repoName, @repoId, @prNumber, @prTitle, @eventType, @severity,
         @source, @message, @detail, @url, @actor, @actorAvatarUrl, @dedupeKey,
         0, 0, @createdAt, NULL
       )
       ON CONFLICT (dedupe_key) DO NOTHING`
    )
    .run({
      userId: input.userId,
      repoName: input.repoName,
      repoId: input.repoId ?? null,
      prNumber: input.prNumber ?? null,
      prTitle: input.prTitle ?? null,
      eventType: input.eventType,
      severity: input.severity ?? EVENT_SEVERITY[input.eventType],
      source: input.source,
      message: input.message,
      detail: input.detail ?? null,
      url: input.url,
      actor: input.actor ?? null,
      actorAvatarUrl: input.actorAvatarUrl ?? null,
      dedupeKey: input.dedupeKey,
      createdAt: nowIso(),
    });

  if (result.changes === 0) {
    log.debug({ dedupeKey: input.dedupeKey }, 'duplicate event ignored');
    return null;
  }

  const row = db.connection
    .prepare('SELECT * FROM notifications WHERE id = ?')
    .get(result.lastInsertRowid) as NotificationRow | undefined;
  return row ? toNotificationDto(row) : null;
}

export function markDelivered(id: string): void {
  db.connection.prepare('UPDATE notifications SET is_delivered = 1 WHERE id = ?').run(Number(id));
}

interface WhereClause {
  sql: string;
  params: Record<string, unknown>;
}

/** Builds the shared WHERE clause for list and count queries. */
function buildWhere(query: NotificationQuery): WhereClause {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.repoName) {
    conditions.push('repo_name = @repoName');
    params.repoName = query.repoName;
  }

  if (query.eventTypes && query.eventTypes.length > 0) {
    // Named parameters cannot expand a list, so one placeholder per value.
    const placeholders = query.eventTypes.map((_, index) => `@eventType${index}`);
    conditions.push(`event_type IN (${placeholders.join(', ')})`);
    query.eventTypes.forEach((value, index) => {
      params[`eventType${index}`] = value;
    });
  }

  if (typeof query.isRead === 'boolean') {
    conditions.push('is_read = @isRead');
    params.isRead = toSqlBool(query.isRead);
  }

  if (query.since) {
    conditions.push('created_at >= @since');
    params.since = query.since;
  }
  if (query.until) {
    conditions.push('created_at < @until');
    params.until = query.until;
  }

  const search = query.search?.trim();
  if (search) {
    // LIKE rather than FTS: with a one-week retention the table stays small,
    // and this matches partial words while the user is still typing.
    conditions.push(
      `(message LIKE @search ESCAPE '\\'
        OR IFNULL(pr_title, '') LIKE @search ESCAPE '\\'
        OR repo_name LIKE @search ESCAPE '\\'
        OR IFNULL(actor, '') LIKE @search ESCAPE '\\')`
    );
    params.search = `%${escapeLike(search)}%`;
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function queryNotifications(query: NotificationQuery): NotificationPage {
  const connection = db.connection;
  const where = buildWhere(query);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_PAGE_SIZE);
  const skip = Math.max(query.skip ?? 0, 0);
  const direction = query.sort === 'oldest' ? 'ASC' : 'DESC';

  const rows = connection
    .prepare(
      `SELECT * FROM notifications ${where.sql}
       ORDER BY created_at ${direction}, id ${direction}
       LIMIT @limit OFFSET @skip`
    )
    .all({ ...where.params, limit, skip }) as NotificationRow[];

  const { total } = connection
    .prepare(`SELECT COUNT(*) AS total FROM notifications ${where.sql}`)
    .get(where.params) as { total: number };

  return {
    items: rows.map(toNotificationDto),
    total,
    unread: unreadCount(),
    limit,
    skip,
  };
}

export function getNotification(id: string): AppNotification | null {
  const row = db.connection.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(id)) as
    | NotificationRow
    | undefined;
  return row ? toNotificationDto(row) : null;
}

export function markRead(ids: string[]): number {
  if (ids.length === 0) {
    return 0;
  }
  const statement = db.connection.prepare(
    'UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND is_read = 0'
  );
  const now = nowIso();
  return db.transaction(() => {
    let changed = 0;
    for (const id of ids) {
      changed += statement.run(now, Number(id)).changes;
    }
    return changed;
  });
}

export function markAllRead(): number {
  return db.connection
    .prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE is_read = 0')
    .run(nowIso()).changes;
}

export function deleteNotifications(ids: string[]): number {
  if (ids.length === 0) {
    return 0;
  }
  const statement = db.connection.prepare('DELETE FROM notifications WHERE id = ?');
  return db.transaction(() => {
    let removed = 0;
    for (const id of ids) {
      removed += statement.run(Number(id)).changes;
    }
    return removed;
  });
}

export function clearAllNotifications(): number {
  const removed = db.connection.prepare('DELETE FROM notifications').run().changes;
  db.maintain();
  return removed;
}

export function unreadCount(): number {
  if (!db.isOpen) {
    return 0;
  }
  const row = db.connection
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0')
    .get() as { count: number };
  return row.count;
}

/** Distinct repo names present in the history, for the filter dropdown. */
export function repoFacets(): string[] {
  const rows = db.connection
    .prepare('SELECT DISTINCT repo_name FROM notifications ORDER BY repo_name')
    .all() as Array<{ repo_name: string }>;
  return rows.map((row) => row.repo_name);
}

/**
 * Deletes notifications older than `retentionDays`, read or not.
 *
 * Read state is deliberately not considered: an unread notification from three
 * weeks ago is not something anyone is going to act on, and keeping it forever
 * only grows the file. 0 disables pruning entirely.
 */
export function pruneOldNotifications(retentionDays: number): number {
  if (retentionDays <= 0 || !db.isOpen) {
    return 0;
  }
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const removed = db.connection
    .prepare('DELETE FROM notifications WHERE created_at < ?')
    .run(cutoff).changes;
  if (removed > 0) {
    log.info({ removed, retentionDays, cutoff }, 'pruned old notifications');
    db.maintain();
  }
  return removed;
}

/** Count of notifications a prune would remove right now. Drives the UI hint. */
export function countOlderThan(days: number): number {
  if (days <= 0 || !db.isOpen) {
    return 0;
  }
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const row = db.connection
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE created_at < ?')
    .get(cutoff) as { count: number };
  return row.count;
}

export function notificationStats(retentionDays: number): NotificationStats {
  if (!db.isOpen) {
    return { total: 0, unread: 0, prunable: 0, oldestAt: null, databaseBytes: 0 };
  }
  const totals = db.connection
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread,
              MIN(created_at) AS oldest
       FROM notifications`
    )
    .get() as { total: number; unread: number | null; oldest: string | null };

  return {
    total: totals.total,
    unread: totals.unread ?? 0,
    prunable: countOlderThan(retentionDays),
    oldestAt: totals.oldest,
    databaseBytes: db.sizeBytes(),
  };
}
