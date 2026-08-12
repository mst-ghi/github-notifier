import type { AppSettings, AppSettingsUpdate } from '../shared/types';
import { database } from './database';
import { type SettingsDocument, SettingsModel, toSettingsDto } from './models';
import { secrets } from './secrets';

/**
 * Reads and writes the single `settings` document. Secrets are never stored
 * here; the DTO only exposes booleans saying whether they exist.
 */

/** Returns the settings document, creating it with defaults on first run. */
export async function getSettingsDoc(): Promise<SettingsDocument> {
  database.assertConnected();
  const existing = await SettingsModel.findOne({ key: 'global' });
  if (existing) {
    return existing;
  }
  return SettingsModel.create({ key: 'global' });
}

export async function getSettings(): Promise<AppSettings> {
  const doc = await getSettingsDoc();
  return toSettingsDto(doc, {
    hasToken: secrets.hasToken(),
    hasWebhookSecret: secrets.hasWebhookSecret(),
  });
}

/** Applies a partial update. Unknown keys are ignored by the schema. */
export async function updateSettings(update: AppSettingsUpdate): Promise<AppSettings> {
  const doc = await getSettingsDoc();
  doc.set(update);
  await doc.save();
  return toSettingsDto(doc, {
    hasToken: secrets.hasToken(),
    hasWebhookSecret: secrets.hasWebhookSecret(),
  });
}

/** Stores the GitHub login the token belongs to. */
export async function setAuthenticatedUser(login: string | null): Promise<void> {
  const doc = await getSettingsDoc();
  doc.userId = login;
  await doc.save();
}

/** Moves the `?since=` cursor used by the notifications poller. */
export async function setNotificationCursor(at: Date): Promise<void> {
  await SettingsModel.updateOne({ key: 'global' }, { $set: { lastNotificationSyncAt: at } });
}
