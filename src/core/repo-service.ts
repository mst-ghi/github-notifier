import { AppError, errorMessage } from '../shared/errors';
import type { Repo, RepoEventFilters, RepoUpdate } from '../shared/types';
import { FILTER_COLUMNS, type RepoRow, toRepoDto } from './db/rows';
import { db, nowIso, toSqlBool } from './db/sqlite';
import { type GithubApi, permissionFromRest } from './github-api';
import { childLogger } from './logger';
import { secrets } from './secrets';
import { getSettings } from './settings-service';

const log = childLogger('repos');

export function listRepos(): Repo[] {
  const rows = db.connection
    .prepare('SELECT * FROM repos ORDER BY monitoring DESC, full_name ASC')
    .all() as RepoRow[];
  return rows.map(toRepoDto);
}

/** Monitored, non-archived repos. Used by the poller on every tick. */
export function listMonitoredRepos(): RepoRow[] {
  return db.connection
    .prepare('SELECT * FROM repos WHERE monitoring = 1 AND archived = 0 ORDER BY full_name')
    .all() as RepoRow[];
}

function findRepoOrThrow(repoId: string): RepoRow {
  const row = db.connection.prepare('SELECT * FROM repos WHERE id = ?').get(Number(repoId)) as
    | RepoRow
    | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', `Repository ${repoId} is not in the database`);
  }
  return row;
}

/**
 * Pulls the repo list from GitHub and upserts it.
 *
 * Monitoring flags and event filters are user state, so the upsert deliberately
 * leaves them alone and overwrites only the GitHub-owned columns.
 */
export async function syncReposFromGithub(github: GithubApi): Promise<Repo[]> {
  const remote = await github.listRepositories();
  const now = nowIso();

  const upsert = db.connection.prepare(
    `INSERT INTO repos (
       github_id, full_name, owner, name, is_private, archived, default_branch,
       html_url, description, permission, monitoring, last_synced_at, created_at, updated_at
     ) VALUES (
       @githubId, @fullName, @owner, @name, @isPrivate, @archived, @defaultBranch,
       @htmlUrl, @description, @permission, 0, @now, @now, @now
     )
     ON CONFLICT (github_id) DO UPDATE SET
       full_name      = excluded.full_name,
       owner          = excluded.owner,
       name           = excluded.name,
       is_private     = excluded.is_private,
       archived       = excluded.archived,
       default_branch = excluded.default_branch,
       html_url       = excluded.html_url,
       description    = excluded.description,
       permission     = excluded.permission,
       last_synced_at = excluded.last_synced_at,
       updated_at     = excluded.updated_at`
  );

  db.transaction(() => {
    for (const repo of remote) {
      upsert.run({
        githubId: repo.id,
        fullName: repo.full_name,
        owner: repo.owner.login,
        name: repo.name,
        isPrivate: toSqlBool(repo.private),
        archived: toSqlBool(repo.archived),
        defaultBranch: repo.default_branch,
        htmlUrl: repo.html_url,
        description: repo.description,
        permission: permissionFromRest(repo),
        now,
      });
    }

    // Repos that vanished from GitHub (access revoked, deleted) are dropped,
    // unless the user was monitoring them: those are kept so the UI can explain
    // why they stopped producing notifications.
    db.connection
      .prepare(
        'DELETE FROM repos WHERE monitoring = 0 AND (last_synced_at IS NULL OR last_synced_at < ?)'
      )
      .run(now);
  });

  log.info({ count: remote.length }, 'repository list synced');
  return listRepos();
}

export function updateRepo(repoId: string, update: RepoUpdate): Repo {
  const row = findRepoOrThrow(repoId);
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (typeof update.monitoring === 'boolean') {
    assignments.push('monitoring = ?');
    values.push(toSqlBool(update.monitoring));
  }

  if (update.eventFilters) {
    for (const [key, value] of Object.entries(update.eventFilters) as Array<
      [keyof RepoEventFilters, boolean | undefined]
    >) {
      const column = FILTER_COLUMNS[key];
      if (column && typeof value === 'boolean') {
        assignments.push(`${column} = ?`);
        values.push(toSqlBool(value));
      }
    }
  }

  if (assignments.length > 0) {
    assignments.push('updated_at = ?');
    values.push(nowIso(), row.id);
    db.connection.prepare(`UPDATE repos SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  }

  return toRepoDto(findRepoOrThrow(repoId));
}

export function setMonitoring(repoId: string, enabled: boolean): Repo {
  return updateRepo(repoId, { monitoring: enabled });
}

/**
 * Registers this app's webhook on a repo.
 *
 * Needs a publicly reachable URL: GitHub cannot POST to localhost. Without one
 * the repo simply stays on poller-only mode, which still covers every event.
 */
export async function installWebhook(github: GithubApi, repoId: string): Promise<Repo> {
  const row = findRepoOrThrow(repoId);
  const settings = getSettings();

  if (!settings.publicWebhookUrl) {
    throw new AppError(
      'VALIDATION',
      'No public webhook URL is set. Add one in Settings, or leave webhooks off and rely on polling.'
    );
  }
  if (row.permission !== 'admin') {
    throw new AppError(
      'MISSING_SCOPE',
      `Admin permission on ${row.full_name} is required to create a webhook. You have "${row.permission}".`
    );
  }

  const secret = secrets.getWebhookSecret() ?? secrets.generateWebhookSecret();
  const payloadUrl = new URL('/webhook', settings.publicWebhookUrl).toString();

  try {
    const hook = await github.upsertWebhook(row.owner, row.name, payloadUrl, secret);
    db.connection
      .prepare(
        `UPDATE repos
         SET webhook_id = ?, webhook_status = ?, webhook_last_error = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(hook.id, hook.active ? 'active' : 'inactive', nowIso(), row.id);
  } catch (error) {
    const message = errorMessage(error);
    db.connection
      .prepare(
        `UPDATE repos SET webhook_status = 'error', webhook_last_error = ?, updated_at = ? WHERE id = ?`
      )
      .run(message, nowIso(), row.id);
    throw new AppError('GITHUB_ERROR', `Could not create webhook: ${message}`, error);
  }

  return toRepoDto(findRepoOrThrow(repoId));
}

export async function removeWebhook(github: GithubApi, repoId: string): Promise<Repo> {
  const row = findRepoOrThrow(repoId);
  if (row.webhook_id !== null) {
    await github.deleteWebhook(row.owner, row.name, row.webhook_id);
  }
  db.connection
    .prepare(
      `UPDATE repos
       SET webhook_id = NULL, webhook_status = 'absent', webhook_last_error = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(nowIso(), row.id);
  return toRepoDto(findRepoOrThrow(repoId));
}

/** Looks a repo up by its numeric GitHub id. Used by the webhook handler. */
export function findRepoByGithubId(githubId: number): RepoRow | null {
  if (!db.isOpen) {
    return null;
  }
  return (
    (db.connection.prepare('SELECT * FROM repos WHERE github_id = ?').get(githubId) as
      | RepoRow
      | undefined) ?? null
  );
}

export function findRepoByFullName(fullName: string): RepoRow | null {
  if (!db.isOpen) {
    return null;
  }
  return (
    (db.connection.prepare('SELECT * FROM repos WHERE full_name = ?').get(fullName) as
      | RepoRow
      | undefined) ?? null
  );
}

export function touchRepoEvent(githubId: number): void {
  db.connection
    .prepare('UPDATE repos SET last_event_at = ? WHERE github_id = ?')
    .run(nowIso(), githubId);
}

export function markConflictScanned(repoId: number): void {
  db.connection
    .prepare('UPDATE repos SET last_conflict_scan_at = ? WHERE id = ?')
    .run(nowIso(), repoId);
}

export function monitoredRepoCount(): number {
  if (!db.isOpen) {
    return 0;
  }
  const row = db.connection
    .prepare('SELECT COUNT(*) AS count FROM repos WHERE monitoring = 1')
    .get() as { count: number };
  return row.count;
}
