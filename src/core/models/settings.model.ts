import { type HydratedDocument, type Model, Schema, model } from 'mongoose';
import {
  DEFAULT_CONFLICT_GRACE_HOURS,
  DEFAULT_CONFLICT_POLL_INTERVAL_SECONDS,
  DEFAULT_CONTROL_PORT,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEFAULT_WEBHOOK_PORT,
} from '../../shared/constants';
import type { AppSettings } from '../../shared/types';

/**
 * Single-document collection. `key` is pinned to `'global'` so an upsert can
 * never create a second row.
 */
export interface SettingsDoc {
  key: 'global';
  userId: string | null;
  webhookPort: number;
  controlPort: number;
  publicWebhookUrl: string | null;
  pollIntervalSeconds: number;
  conflictPollIntervalSeconds: number;
  conflictGraceHours: number;
  notificationsEnabled: boolean;
  paused: boolean;
  soundEnabled: boolean;
  onlyMyPullRequests: boolean;
  startMinimized: boolean;
  retentionDays: number;
  theme: 'light' | 'dark' | 'system';
  /** Cursor for the GitHub notifications API (`?since=`). */
  lastNotificationSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SettingsDocument = HydratedDocument<SettingsDoc>;

const settingsSchema = new Schema<SettingsDoc>(
  {
    key: { type: String, enum: ['global'], default: 'global', unique: true },
    userId: { type: String, default: null },
    webhookPort: { type: Number, default: DEFAULT_WEBHOOK_PORT, min: 1, max: 65535 },
    controlPort: { type: Number, default: DEFAULT_CONTROL_PORT, min: 1, max: 65535 },
    publicWebhookUrl: { type: String, default: null },
    pollIntervalSeconds: { type: Number, default: DEFAULT_POLL_INTERVAL_SECONDS, min: 30 },
    conflictPollIntervalSeconds: {
      type: Number,
      default: DEFAULT_CONFLICT_POLL_INTERVAL_SECONDS,
      min: 300,
    },
    conflictGraceHours: { type: Number, default: DEFAULT_CONFLICT_GRACE_HOURS, min: 0 },
    notificationsEnabled: { type: Boolean, default: true },
    paused: { type: Boolean, default: false },
    soundEnabled: { type: Boolean, default: false },
    onlyMyPullRequests: { type: Boolean, default: true },
    startMinimized: { type: Boolean, default: false },
    retentionDays: { type: Number, default: 90, min: 0 },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    lastNotificationSyncAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'settings' }
);

export const SettingsModel: Model<SettingsDoc> = model<SettingsDoc>('Settings', settingsSchema);

/**
 * `hasToken`/`hasWebhookSecret` are supplied by the caller because secrets live
 * in the keyring, not in Mongo.
 */
export function toSettingsDto(
  doc: SettingsDocument,
  flags: { hasToken: boolean; hasWebhookSecret: boolean }
): AppSettings {
  return {
    userId: doc.userId,
    webhookPort: doc.webhookPort,
    controlPort: doc.controlPort,
    publicWebhookUrl: doc.publicWebhookUrl,
    pollIntervalSeconds: doc.pollIntervalSeconds,
    conflictPollIntervalSeconds: doc.conflictPollIntervalSeconds,
    conflictGraceHours: doc.conflictGraceHours,
    notificationsEnabled: doc.notificationsEnabled,
    paused: doc.paused,
    soundEnabled: doc.soundEnabled,
    onlyMyPullRequests: doc.onlyMyPullRequests,
    startMinimized: doc.startMinimized,
    retentionDays: doc.retentionDays,
    theme: doc.theme,
    hasToken: flags.hasToken,
    hasWebhookSecret: flags.hasWebhookSecret,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
