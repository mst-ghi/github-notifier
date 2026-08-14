import { AppError, errorMessage } from '../shared/errors';
import type { OpenPullRequestCounts, PullRequestDetail, PullRequestSummary } from '../shared/types';
import { type RepoRow, toRepoDto } from './db/rows';
import { db, nowIso } from './db/sqlite';
import type { GithubApi } from './github-api';
import { childLogger } from './logger';
import { listMonitoredRepos } from './repo-service';

const log = childLogger('pull-requests');

/**
 * Open pull requests for the repository pages.
 *
 * Counts are cached in the `repos` table so the sidebar total is instant and
 * survives a restart. A refresh costs one GitHub request per monitored
 * repository, so it is rate-limited by age rather than run on every render.
 */

/** How long a cached count is considered good enough. */
const COUNT_TTL_MS = 5 * 60_000;

function findRepoRow(repoId: string): RepoRow {
  const row = db.connection.prepare('SELECT * FROM repos WHERE id = ?').get(Number(repoId)) as
    | RepoRow
    | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', `Repository ${repoId} is not in the database`);
  }
  return row;
}

/** The viewer's login, used to flag "mine" without another API call. */
async function viewerLogin(github: GithubApi): Promise<string> {
  try {
    return (await github.getAuthenticatedUser()).login;
  } catch {
    return '';
  }
}

export async function listOpenPullRequests(
  github: GithubApi,
  repoId: string
): Promise<PullRequestSummary[]> {
  const row = findRepoRow(repoId);
  const login = await viewerLogin(github);
  const pulls = await github.listOpenPullRequestsDetailed(row.owner, row.name, login);

  // The list we just fetched is a better count than whatever was cached.
  writeCount(row.id, pulls.length);
  return pulls;
}

/** Detail for a pull request identified by owner/repo, not by local row id. */
export async function getPullRequestDetailByRef(
  github: GithubApi,
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestDetail> {
  const login = await viewerLogin(github);
  return github.getPullRequestDetail(owner, repo, number, login);
}

export async function getPullRequestDetail(
  github: GithubApi,
  repoId: string,
  number: number
): Promise<PullRequestDetail> {
  const row = findRepoRow(repoId);
  const login = await viewerLogin(github);
  return github.getPullRequestDetail(row.owner, row.name, number, login);
}

function writeCount(rowId: number, count: number): void {
  db.connection
    .prepare('UPDATE repos SET open_pr_count = ?, open_pr_synced_at = ? WHERE id = ?')
    .run(count, nowIso(), rowId);
}

/** Reads cached counts without touching the network. */
export function cachedCounts(): OpenPullRequestCounts {
  if (!db.isOpen) {
    return { total: 0, byRepoId: {}, refreshedAt: null, stale: true, error: null };
  }

  const rows = listMonitoredRepos();
  const byRepoId: Record<string, number> = {};
  let total = 0;
  let oldest: string | null = null;
  let anyMissing = false;

  for (const row of rows) {
    byRepoId[String(row.id)] = row.open_pr_count;
    total += row.open_pr_count;
    if (!row.open_pr_synced_at) {
      anyMissing = true;
    } else if (oldest === null || row.open_pr_synced_at < oldest) {
      oldest = row.open_pr_synced_at;
    }
  }

  const stale = anyMissing || oldest === null || Date.now() - Date.parse(oldest) > COUNT_TTL_MS;

  return { total, byRepoId, refreshedAt: oldest, stale, error: null };
}

/**
 * Refreshes counts for every monitored repository.
 *
 * A failure on one repository must not lose the others, so each is caught
 * individually and the cached value is kept.
 */
export async function refreshCounts(
  github: GithubApi,
  options: { force?: boolean } = {}
): Promise<OpenPullRequestCounts> {
  const current = cachedCounts();
  if (!options.force && !current.stale) {
    return current;
  }
  if (!github.isReady) {
    return { ...current, error: 'Add a GitHub token in Settings to count pull requests.' };
  }

  const rows = listMonitoredRepos();
  let failures = 0;

  for (const row of rows) {
    try {
      const count = await github.countOpenPullRequests(row.owner, row.name);
      writeCount(row.id, count);
    } catch (error) {
      failures += 1;
      log.warn({ repo: row.full_name, err: errorMessage(error) }, 'could not count pull requests');
    }
  }

  const refreshed = cachedCounts();
  log.info(
    { repos: rows.length, total: refreshed.total, failures },
    'pull-request counts refreshed'
  );

  return {
    ...refreshed,
    error:
      failures > 0
        ? `${failures} of ${rows.length} repositories could not be counted; showing the last known numbers for those.`
        : null,
  };
}

/** Monitored repositories, newest activity first, for the "Active" section. */
export function listActiveRepos(): ReturnType<typeof toRepoDto>[] {
  return listMonitoredRepos().map(toRepoDto);
}

export function getRepo(repoId: string): ReturnType<typeof toRepoDto> {
  return toRepoDto(findRepoRow(repoId));
}
