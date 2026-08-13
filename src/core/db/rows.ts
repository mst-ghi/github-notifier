import type {
  AppNotification,
  AppSettings,
  EventType,
  NotificationSeverity,
  NotificationSource,
  Repo,
  RepoEventFilters,
  RepoPermission,
  WebhookStatus,
} from '../../shared/types';
import { fromSqlBool } from './sqlite';

/**
 * Raw row shapes as SQLite returns them, plus the mappers to the DTOs the rest
 * of the app uses. Keeping the conversion here means no other module has to
 * know that booleans are integers and timestamps are strings.
 */

export interface SettingsRow {
  id: number;
  user_id: string | null;
  webhook_port: number;
  control_port: number;
  public_webhook_url: string | null;
  poll_interval_seconds: number;
  conflict_poll_interval_seconds: number;
  conflict_grace_hours: number;
  notifications_enabled: number;
  paused: number;
  sound_enabled: number;
  only_my_pull_requests: number;
  start_minimized: number;
  retention_days: number;
  theme: string;
  last_notification_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepoRow {
  id: number;
  github_id: number;
  full_name: string;
  owner: string;
  name: string;
  is_private: number;
  archived: number;
  default_branch: string;
  html_url: string;
  description: string | null;
  permission: string;
  monitoring: number;
  filter_comments: number;
  filter_reviews: number;
  filter_merges: number;
  filter_conflicts: number;
  filter_checks: number;
  filter_assignments: number;
  webhook_id: number | null;
  webhook_status: string;
  webhook_last_error: string | null;
  last_synced_at: string | null;
  last_event_at: string | null;
  last_conflict_scan_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: number;
  user_id: string;
  repo_name: string;
  repo_id: number | null;
  pr_number: number | null;
  pr_title: string | null;
  event_type: string;
  severity: string;
  source: string;
  message: string;
  detail: string | null;
  url: string;
  actor: string | null;
  actor_avatar_url: string | null;
  dedupe_key: string;
  is_read: number;
  is_delivered: number;
  created_at: string;
  read_at: string | null;
}

export function toEventFilters(row: RepoRow): RepoEventFilters {
  return {
    comments: fromSqlBool(row.filter_comments),
    reviews: fromSqlBool(row.filter_reviews),
    merges: fromSqlBool(row.filter_merges),
    conflicts: fromSqlBool(row.filter_conflicts),
    checks: fromSqlBool(row.filter_checks),
    assignments: fromSqlBool(row.filter_assignments),
  };
}

/** Maps a filter name onto its column, so callers cannot build column names. */
export const FILTER_COLUMNS: Readonly<Record<keyof RepoEventFilters, string>> = {
  comments: 'filter_comments',
  reviews: 'filter_reviews',
  merges: 'filter_merges',
  conflicts: 'filter_conflicts',
  checks: 'filter_checks',
  assignments: 'filter_assignments',
};

export function toRepoDto(row: RepoRow): Repo {
  return {
    id: String(row.id),
    githubId: row.github_id,
    fullName: row.full_name,
    owner: row.owner,
    name: row.name,
    private: fromSqlBool(row.is_private),
    archived: fromSqlBool(row.archived),
    defaultBranch: row.default_branch,
    htmlUrl: row.html_url,
    description: row.description,
    permission: row.permission as RepoPermission,
    monitoring: fromSqlBool(row.monitoring),
    eventFilters: toEventFilters(row),
    webhookId: row.webhook_id,
    webhookStatus: row.webhook_status as WebhookStatus,
    webhookLastError: row.webhook_last_error,
    lastSyncedAt: row.last_synced_at,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toNotificationDto(row: NotificationRow): AppNotification {
  return {
    id: String(row.id),
    userId: row.user_id,
    repoName: row.repo_name,
    repoId: row.repo_id,
    prNumber: row.pr_number,
    prTitle: row.pr_title,
    eventType: row.event_type as EventType,
    severity: row.severity as NotificationSeverity,
    source: row.source as NotificationSource,
    message: row.message,
    detail: row.detail,
    url: row.url,
    actor: row.actor,
    actorAvatarUrl: row.actor_avatar_url,
    dedupeKey: row.dedupe_key,
    isRead: fromSqlBool(row.is_read),
    isDelivered: fromSqlBool(row.is_delivered),
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export function toSettingsDto(
  row: SettingsRow,
  flags: { hasToken: boolean; hasWebhookSecret: boolean }
): AppSettings {
  return {
    userId: row.user_id,
    webhookPort: row.webhook_port,
    controlPort: row.control_port,
    publicWebhookUrl: row.public_webhook_url,
    pollIntervalSeconds: row.poll_interval_seconds,
    conflictPollIntervalSeconds: row.conflict_poll_interval_seconds,
    conflictGraceHours: row.conflict_grace_hours,
    notificationsEnabled: fromSqlBool(row.notifications_enabled),
    paused: fromSqlBool(row.paused),
    soundEnabled: fromSqlBool(row.sound_enabled),
    onlyMyPullRequests: fromSqlBool(row.only_my_pull_requests),
    startMinimized: fromSqlBool(row.start_minimized),
    retentionDays: row.retention_days,
    theme: row.theme === 'light' || row.theme === 'dark' ? row.theme : 'system',
    hasToken: flags.hasToken,
    hasWebhookSecret: flags.hasWebhookSecret,
    updatedAt: row.updated_at,
  };
}
