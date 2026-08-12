import type { FilterQuery } from 'mongoose';
import { EVENT_SEVERITY } from '../shared/format';
import type {
  AppNotification,
  EventType,
  NotificationPage,
  NotificationQuery,
  NotificationSeverity,
  NotificationSource,
} from '../shared/types';
import { database } from './database';
import { childLogger } from './logger';
import { type NotificationDoc, NotificationModel, toNotificationDto } from './models';

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

/** Mongo duplicate-key error code. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === DUPLICATE_KEY
  );
}

/**
 * Inserts a notification.
 *
 * Returns `null` when the event was already recorded, which is the normal case
 * whenever a repo has both a webhook and the poller enabled. Callers use the
 * null to decide whether to raise a desktop toast.
 */
export async function createNotification(input: NewNotification): Promise<AppNotification | null> {
  database.assertConnected();
  try {
    const doc = await NotificationModel.create({
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
      isRead: false,
      isDelivered: false,
      readAt: null,
    });
    return toNotificationDto(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      log.debug({ dedupeKey: input.dedupeKey }, 'duplicate event ignored');
      return null;
    }
    throw error;
  }
}

export async function markDelivered(id: string): Promise<void> {
  await NotificationModel.updateOne({ _id: id }, { $set: { isDelivered: true } });
}

/** Builds the Mongo filter for a UI query. */
function buildFilter(query: NotificationQuery): FilterQuery<NotificationDoc> {
  const filter: FilterQuery<NotificationDoc> = {};

  if (query.repoName) {
    filter.repoName = query.repoName;
  }
  if (query.eventTypes && query.eventTypes.length > 0) {
    filter.eventType = { $in: query.eventTypes };
  }
  if (typeof query.isRead === 'boolean') {
    filter.isRead = query.isRead;
  }
  if (query.since || query.until) {
    const range: Record<string, Date> = {};
    if (query.since) {
      range.$gte = new Date(query.since);
    }
    if (query.until) {
      range.$lt = new Date(query.until);
    }
    filter.createdAt = range;
  }
  if (query.search && query.search.trim() !== '') {
    // Regex instead of $text so partial words match while the user is typing.
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [
      { message: pattern },
      { prTitle: pattern },
      { repoName: pattern },
      { actor: pattern },
    ];
  }
  return filter;
}

const MAX_PAGE_SIZE = 200;

export async function queryNotifications(query: NotificationQuery): Promise<NotificationPage> {
  database.assertConnected();
  const filter = buildFilter(query);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_PAGE_SIZE);
  const skip = Math.max(query.skip ?? 0, 0);
  const sortDirection = query.sort === 'oldest' ? 1 : -1;

  const [docs, total, unread] = await Promise.all([
    NotificationModel.find(filter).sort({ createdAt: sortDirection }).skip(skip).limit(limit),
    NotificationModel.countDocuments(filter),
    NotificationModel.countDocuments({ isRead: false }),
  ]);

  return { items: docs.map(toNotificationDto), total, unread, limit, skip };
}

export async function getNotification(id: string): Promise<AppNotification | null> {
  database.assertConnected();
  const doc = await NotificationModel.findById(id);
  return doc ? toNotificationDto(doc) : null;
}

export async function markRead(ids: string[]): Promise<number> {
  database.assertConnected();
  if (ids.length === 0) {
    return 0;
  }
  const result = await NotificationModel.updateMany(
    { _id: { $in: ids }, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  return result.modifiedCount;
}

export async function markAllRead(): Promise<number> {
  database.assertConnected();
  const result = await NotificationModel.updateMany(
    { isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  return result.modifiedCount;
}

export async function deleteNotifications(ids: string[]): Promise<number> {
  database.assertConnected();
  if (ids.length === 0) {
    return 0;
  }
  const result = await NotificationModel.deleteMany({ _id: { $in: ids } });
  return result.deletedCount ?? 0;
}

export async function clearAllNotifications(): Promise<number> {
  database.assertConnected();
  const result = await NotificationModel.deleteMany({});
  return result.deletedCount ?? 0;
}

export async function unreadCount(): Promise<number> {
  if (!database.isConnected) {
    return 0;
  }
  return NotificationModel.countDocuments({ isRead: false });
}

/** Distinct repo names present in the history, for the filter dropdown. */
export async function repoFacets(): Promise<string[]> {
  database.assertConnected();
  const values = await NotificationModel.distinct('repoName');
  return values.filter((value): value is string => typeof value === 'string').sort();
}

/** Deletes read notifications older than `retentionDays`. 0 disables pruning. */
export async function pruneOldNotifications(retentionDays: number): Promise<number> {
  if (retentionDays <= 0 || !database.isConnected) {
    return 0;
  }
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);
  const result = await NotificationModel.deleteMany({ createdAt: { $lt: cutoff }, isRead: true });
  const deleted = result.deletedCount ?? 0;
  if (deleted > 0) {
    log.info({ deleted, retentionDays }, 'pruned old notifications');
  }
  return deleted;
}
