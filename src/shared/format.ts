import type { EventType, NotificationSeverity } from './types/domain';

/** Human label for each event type. Used in the UI and the desktop toast title. */
export const EVENT_LABELS: Readonly<Record<EventType, string>> = {
  pr_comment: 'New comment',
  pr_review_comment: 'Review comment',
  pr_review: 'Review submitted',
  pr_merged: 'Pull request merged',
  pr_closed: 'Pull request closed',
  pr_conflict: 'Merge conflict',
  pr_conflict_resolved: 'Conflict resolved',
  check_failed: 'Checks failed',
  check_succeeded: 'Checks passed',
  pr_assigned: 'Assigned to you',
  review_requested: 'Review requested',
  system: 'System',
};

export const EVENT_SEVERITY: Readonly<Record<EventType, NotificationSeverity>> = {
  pr_comment: 'info',
  pr_review_comment: 'info',
  pr_review: 'info',
  pr_merged: 'success',
  pr_closed: 'info',
  pr_conflict: 'warning',
  pr_conflict_resolved: 'success',
  check_failed: 'error',
  check_succeeded: 'success',
  pr_assigned: 'info',
  review_requested: 'info',
  system: 'info',
};

const RELATIVE_UNITS: ReadonlyArray<[limitSeconds: number, divisor: number, unit: string]> = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [604800, 86400, 'day'],
  [2629800, 604800, 'week'],
  [31557600, 2629800, 'month'],
];

/** "3 minutes ago" style formatting without pulling in a date library. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return 'unknown';
  }
  const deltaSeconds = Math.round((then - now) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  for (const [limit, divisor, unit] of RELATIVE_UNITS) {
    if (absolute < limit) {
      return formatter.format(
        Math.round(deltaSeconds / divisor),
        unit as Intl.RelativeTimeFormatUnit
      );
    }
  }
  return formatter.format(Math.round(deltaSeconds / 31557600), 'year');
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Trims a string to `max` characters, adding an ellipsis when it was cut. */
export function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/** Badge text for the tray. GitHub-style: caps at "99+". */
export function badgeText(count: number): string {
  if (count <= 0) {
    return '';
  }
  return count > 99 ? '99+' : String(count);
}
