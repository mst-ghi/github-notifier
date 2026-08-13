import { errorMessage, errorStatus } from '../shared/errors';
import type { UpdateInfo } from '../shared/types';
import { type GithubApi, github } from './github-api';
import { childLogger } from './logger';

const log = childLogger('updater');

/** Where releases are published. */
export const RELEASE_OWNER = 'mst-ghi' as const;
export const RELEASE_REPO = 'github-notifier' as const;

/**
 * Checks GitHub Releases for a newer build.
 *
 * It only *reports*; it never downloads or installs anything. Linux packages
 * are unsigned here, so silently replacing an installed .deb would be a worse
 * trade than asking the user to click through to the release page.
 *
 * The call goes through the authenticated client because the repository may be
 * private, in which case an anonymous request would 404.
 */
export async function checkForUpdates(
  currentVersion: string,
  client: GithubApi = github
): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    publishedAt: null,
    downloadUrl: null,
    notes: null,
    error: null,
  };

  if (!client.isReady) {
    return { ...base, error: 'Add a GitHub token in Settings to check for updates.' };
  }

  try {
    const release = await client.getLatestRelease(RELEASE_OWNER, RELEASE_REPO);
    if (!release) {
      return { ...base, error: 'No releases have been published yet.' };
    }

    const latestVersion = normaliseVersion(release.tagName);
    const deb = release.assets.find((asset) => asset.name.endsWith('.deb'));

    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, normaliseVersion(currentVersion)) > 0,
      releaseUrl: release.htmlUrl,
      publishedAt: release.publishedAt,
      downloadUrl: deb?.browserDownloadUrl ?? null,
      notes: release.body,
      error: null,
    };
  } catch (error) {
    const status = errorStatus(error);
    const message =
      status === 404
        ? 'No releases found, or the token cannot see this repository.'
        : errorMessage(error);
    log.warn({ err: message }, 'update check failed');
    return { ...base, error: message };
  }
}

/** Strips a leading `v` and any build metadata. */
export function normaliseVersion(version: string): string {
  return version.trim().replace(/^v/i, '').split('+')[0] ?? version;
}

/**
 * Semver comparison, enough for this app's own tags.
 *
 * Returns >0 when `a` is newer. A prerelease sorts *below* the same version
 * without one, so 2.0.0 beats 2.0.0-rc.1.
 */
export function compareVersions(a: string, b: string): number {
  const [aCore = '', aPre = ''] = a.split('-', 2);
  const [bCore = '', bPre = ''] = b.split('-', 2);

  const aParts = aCore.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bParts = bCore.split('.').map((part) => Number.parseInt(part, 10) || 0);

  for (let index = 0; index < 3; index += 1) {
    const diff = (aParts[index] ?? 0) - (bParts[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  if (aPre === bPre) {
    return 0;
  }
  if (aPre === '') {
    return 1;
  }
  if (bPre === '') {
    return -1;
  }
  return aPre > bPre ? 1 : -1;
}
