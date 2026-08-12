import { type HydratedDocument, type Model, Schema, model } from 'mongoose';
import type { Repo, RepoEventFilters, RepoPermission, WebhookStatus } from '../../shared/types';

/** Mongo document shape for the `repos` collection. */
export interface RepoDoc {
  githubId: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  htmlUrl: string;
  description: string | null;
  permission: RepoPermission;
  monitoring: boolean;
  eventFilters: RepoEventFilters;
  webhookId: number | null;
  webhookStatus: WebhookStatus;
  webhookLastError: string | null;
  lastSyncedAt: Date | null;
  lastEventAt: Date | null;
  /** Cursor for the conflict poller: last time we checked this repo's PRs. */
  lastConflictScanAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RepoDocument = HydratedDocument<RepoDoc>;

export const DEFAULT_EVENT_FILTERS: RepoEventFilters = {
  comments: true,
  reviews: true,
  merges: true,
  conflicts: true,
  checks: false,
  assignments: true,
};

const eventFiltersSchema = new Schema<RepoEventFilters>(
  {
    comments: { type: Boolean, default: true },
    reviews: { type: Boolean, default: true },
    merges: { type: Boolean, default: true },
    conflicts: { type: Boolean, default: true },
    checks: { type: Boolean, default: false },
    assignments: { type: Boolean, default: true },
  },
  { _id: false }
);

const repoSchema = new Schema<RepoDoc>(
  {
    githubId: { type: Number, required: true, unique: true, index: true },
    fullName: { type: String, required: true, index: true },
    owner: { type: String, required: true },
    name: { type: String, required: true },
    private: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    defaultBranch: { type: String, default: 'main' },
    htmlUrl: { type: String, required: true },
    description: { type: String, default: null },
    permission: {
      type: String,
      enum: ['read', 'triage', 'write', 'maintain', 'admin'],
      default: 'read',
    },
    monitoring: { type: Boolean, default: false, index: true },
    eventFilters: { type: eventFiltersSchema, default: () => ({ ...DEFAULT_EVENT_FILTERS }) },
    webhookId: { type: Number, default: null },
    webhookStatus: {
      type: String,
      enum: ['absent', 'active', 'inactive', 'error', 'unmanaged'],
      default: 'absent',
    },
    webhookLastError: { type: String, default: null },
    lastSyncedAt: { type: Date, default: null },
    lastEventAt: { type: Date, default: null },
    lastConflictScanAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'repos' }
);

// Monitored repos are read on every poll tick; this keeps that lookup covered.
repoSchema.index({ monitoring: 1, lastConflictScanAt: 1 });
repoSchema.index({ fullName: 'text', description: 'text' });

export const RepoModel: Model<RepoDoc> = model<RepoDoc>('Repo', repoSchema);

/** Converts a Mongo document into the plain object sent over IPC. */
export function toRepoDto(doc: RepoDocument): Repo {
  return {
    id: doc._id.toString(),
    githubId: doc.githubId,
    fullName: doc.fullName,
    owner: doc.owner,
    name: doc.name,
    private: doc.private,
    archived: doc.archived,
    defaultBranch: doc.defaultBranch,
    htmlUrl: doc.htmlUrl,
    description: doc.description,
    permission: doc.permission,
    monitoring: doc.monitoring,
    eventFilters: { ...DEFAULT_EVENT_FILTERS, ...doc.eventFilters },
    webhookId: doc.webhookId,
    webhookStatus: doc.webhookStatus,
    webhookLastError: doc.webhookLastError,
    lastSyncedAt: doc.lastSyncedAt ? doc.lastSyncedAt.toISOString() : null,
    lastEventAt: doc.lastEventAt ? doc.lastEventAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
