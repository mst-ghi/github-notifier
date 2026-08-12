import { AppError, errorMessage } from '../shared/errors';
import type { Repo, RepoUpdate } from '../shared/types';
import { database } from './database';
import { type GithubApi, permissionFromRest } from './github-api';
import { childLogger } from './logger';
import { type RepoDocument, RepoModel, toRepoDto } from './models';
import { secrets } from './secrets';
import { getSettings } from './settings-service';

const log = childLogger('repos');

export async function listRepos(): Promise<Repo[]> {
  database.assertConnected();
  const docs = await RepoModel.find().sort({ monitoring: -1, fullName: 1 });
  return docs.map(toRepoDto);
}

export async function listMonitoredRepos(): Promise<RepoDocument[]> {
  database.assertConnected();
  return RepoModel.find({ monitoring: true, archived: false });
}

async function findRepoOrThrow(repoId: string): Promise<RepoDocument> {
  database.assertConnected();
  const doc = await RepoModel.findById(repoId);
  if (!doc) {
    throw new AppError('NOT_FOUND', `Repository ${repoId} is not in the database`);
  }
  return doc;
}

/**
 * Pulls the repo list from GitHub and upserts it.
 *
 * Monitoring flags and event filters are user state, so they are deliberately
 * left untouched: only the GitHub-owned fields are overwritten.
 */
export async function syncReposFromGithub(github: GithubApi): Promise<Repo[]> {
  database.assertConnected();
  const remote = await github.listRepositories();
  const now = new Date();

  const operations = remote.map((repo) => ({
    updateOne: {
      filter: { githubId: repo.id },
      update: {
        $set: {
          fullName: repo.full_name,
          owner: repo.owner.login,
          name: repo.name,
          private: repo.private,
          archived: repo.archived,
          defaultBranch: repo.default_branch,
          htmlUrl: repo.html_url,
          description: repo.description,
          permission: permissionFromRest(repo),
          lastSyncedAt: now,
        },
        $setOnInsert: { githubId: repo.id, monitoring: false },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) {
    await RepoModel.bulkWrite(operations, { ordered: false });
  }

  // Repos that disappeared from GitHub (access revoked, deleted) are dropped
  // unless the user was monitoring them; those are kept so the UI can explain.
  const visibleIds = remote.map((repo) => repo.id);
  await RepoModel.deleteMany({ githubId: { $nin: visibleIds }, monitoring: false });

  log.info({ count: remote.length }, 'repository list synced');
  return listRepos();
}

export async function updateRepo(repoId: string, update: RepoUpdate): Promise<Repo> {
  const doc = await findRepoOrThrow(repoId);
  if (typeof update.monitoring === 'boolean') {
    doc.monitoring = update.monitoring;
  }
  if (update.eventFilters) {
    doc.eventFilters = { ...doc.eventFilters, ...update.eventFilters };
  }
  await doc.save();
  return toRepoDto(doc);
}

export async function setMonitoring(repoId: string, enabled: boolean): Promise<Repo> {
  return updateRepo(repoId, { monitoring: enabled });
}

/**
 * Registers this app's webhook on a repo.
 *
 * Needs a publicly reachable URL: GitHub cannot POST to localhost. When
 * `publicWebhookUrl` is unset the repo simply stays on poller-only mode, which
 * still works for every event except sub-minute latency.
 */
export async function installWebhook(github: GithubApi, repoId: string): Promise<Repo> {
  const doc = await findRepoOrThrow(repoId);
  const settings = await getSettings();

  if (!settings.publicWebhookUrl) {
    throw new AppError(
      'VALIDATION',
      'No public webhook URL is set. Add one in Settings, or leave webhooks off and rely on polling.'
    );
  }
  if (doc.permission !== 'admin') {
    throw new AppError(
      'MISSING_SCOPE',
      `Admin permission on ${doc.fullName} is required to create a webhook. You have "${doc.permission}".`
    );
  }

  const secret = secrets.getWebhookSecret() ?? secrets.generateWebhookSecret();
  const payloadUrl = new URL('/webhook', settings.publicWebhookUrl).toString();

  try {
    const hook = await github.upsertWebhook(doc.owner, doc.name, payloadUrl, secret);
    doc.webhookId = hook.id;
    doc.webhookStatus = hook.active ? 'active' : 'inactive';
    doc.webhookLastError = null;
  } catch (error) {
    doc.webhookStatus = 'error';
    doc.webhookLastError = errorMessage(error);
    await doc.save();
    throw new AppError('GITHUB_ERROR', `Could not create webhook: ${errorMessage(error)}`, error);
  }

  await doc.save();
  return toRepoDto(doc);
}

export async function removeWebhook(github: GithubApi, repoId: string): Promise<Repo> {
  const doc = await findRepoOrThrow(repoId);
  if (doc.webhookId !== null) {
    await github.deleteWebhook(doc.owner, doc.name, doc.webhookId);
  }
  doc.webhookId = null;
  doc.webhookStatus = 'absent';
  doc.webhookLastError = null;
  await doc.save();
  return toRepoDto(doc);
}

/** Looks a repo up by its numeric GitHub id. Used by the webhook handler. */
export async function findRepoByGithubId(githubId: number): Promise<RepoDocument | null> {
  if (!database.isConnected) {
    return null;
  }
  return RepoModel.findOne({ githubId });
}

export async function findRepoByFullName(fullName: string): Promise<RepoDocument | null> {
  if (!database.isConnected) {
    return null;
  }
  return RepoModel.findOne({ fullName });
}

export async function touchRepoEvent(githubId: number): Promise<void> {
  await RepoModel.updateOne({ githubId }, { $set: { lastEventAt: new Date() } });
}

export async function monitoredRepoCount(): Promise<number> {
  if (!database.isConnected) {
    return 0;
  }
  return RepoModel.countDocuments({ monitoring: true });
}
