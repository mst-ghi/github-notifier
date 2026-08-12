import { type HydratedDocument, type Model, Schema, model } from 'mongoose';
import { EVENT_TYPES } from '../../shared/constants';
import type {
  AppNotification,
  EventType,
  NotificationSeverity,
  NotificationSource,
} from '../../shared/types';

/** Mongo document shape for the `notifications` collection. */
export interface NotificationDoc {
  userId: string;
  repoName: string;
  repoId: number | null;
  prNumber: number | null;
  prTitle: string | null;
  eventType: EventType;
  severity: NotificationSeverity;
  source: NotificationSource;
  message: string;
  detail: string | null;
  url: string;
  actor: string | null;
  actorAvatarUrl: string | null;
  dedupeKey: string;
  isRead: boolean;
  isDelivered: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<NotificationDoc>;

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: String, required: true, index: true },
    repoName: { type: String, required: true, index: true },
    repoId: { type: Number, default: null },
    prNumber: { type: Number, default: null },
    prTitle: { type: String, default: null },
    eventType: { type: String, enum: EVENT_TYPES, required: true, index: true },
    severity: {
      type: String,
      enum: ['info', 'success', 'warning', 'error'],
      default: 'info',
    },
    source: {
      type: String,
      enum: ['webhook', 'poller', 'manual', 'system'],
      default: 'poller',
    },
    message: { type: String, required: true },
    detail: { type: String, default: null },
    url: { type: String, required: true },
    actor: { type: String, default: null },
    actorAvatarUrl: { type: String, default: null },
    // Unique so the webhook and the poller can both report the same event
    // without producing two toasts. Insert conflicts are swallowed by callers.
    dedupeKey: { type: String, required: true, unique: true },
    isRead: { type: Boolean, default: false, index: true },
    isDelivered: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'notifications' }
);

// The list view is "newest first, optionally filtered"; these cover it.
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ isRead: 1, createdAt: -1 });
notificationSchema.index({ repoName: 1, createdAt: -1 });
notificationSchema.index({ eventType: 1, createdAt: -1 });
// Free-text search over the parts a user would actually type.
notificationSchema.index({ message: 'text', prTitle: 'text', repoName: 'text' });

export const NotificationModel: Model<NotificationDoc> = model<NotificationDoc>(
  'Notification',
  notificationSchema
);

export function toNotificationDto(doc: NotificationDocument): AppNotification {
  return {
    id: doc._id.toString(),
    userId: doc.userId,
    repoName: doc.repoName,
    repoId: doc.repoId,
    prNumber: doc.prNumber,
    prTitle: doc.prTitle,
    eventType: doc.eventType,
    severity: doc.severity,
    source: doc.source,
    message: doc.message,
    detail: doc.detail,
    url: doc.url,
    actor: doc.actor,
    actorAvatarUrl: doc.actorAvatarUrl,
    dedupeKey: doc.dedupeKey,
    isRead: doc.isRead,
    isDelivered: doc.isDelivered,
    createdAt: doc.createdAt.toISOString(),
    readAt: doc.readAt ? doc.readAt.toISOString() : null,
  };
}
