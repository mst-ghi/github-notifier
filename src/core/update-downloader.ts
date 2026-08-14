import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError, errorMessage } from '../shared/errors';
import type { UpdateDownload } from '../shared/types';
import type { GithubApi } from './github-api';
import { childLogger } from './logger';
import { RELEASE_OWNER, RELEASE_REPO, checkForUpdates } from './updater';

const log = childLogger('update-download');

/** Progress is pushed at most this often, so the UI is not flooded. */
const PROGRESS_INTERVAL_MS = 200;

const IDLE: UpdateDownload = {
  status: 'idle',
  version: null,
  fileName: null,
  filePath: null,
  receivedBytes: 0,
  totalBytes: 0,
  percent: 0,
  bytesPerSecond: 0,
  checksumVerified: false,
  error: null,
};

export interface DownloaderEvents {
  progress: [UpdateDownload];
}

/**
 * Downloads a release package.
 *
 * It saves the file and stops there. Installing a .deb needs root, so the app
 * deliberately does not run it — it hands over a verified file and the one
 * command to install it. Nothing downloaded here is ever executed.
 *
 * The published SHA256SUMS.txt is checked against the bytes that arrived. A
 * mismatch deletes the file rather than leaving something unexpected in the
 * user's Downloads folder.
 */
export class UpdateDownloader extends EventEmitter<DownloaderEvents> {
  private current: UpdateDownload = { ...IDLE };
  private controller: AbortController | null = null;

  get state(): UpdateDownload {
    return { ...this.current };
  }

  private update(patch: Partial<UpdateDownload>): void {
    this.current = { ...this.current, ...patch };
    this.emit('progress', this.state);
  }

  get isRunning(): boolean {
    return this.current.status === 'downloading' || this.current.status === 'verifying';
  }

  /** Aborts an in-flight download. Safe to call when nothing is running. */
  cancel(): UpdateDownload {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    return this.state;
  }

  /**
   * Finds the newest release, downloads its .deb into the Downloads folder and
   * verifies the checksum. `directory` is passed in so the core has no
   * dependency on Electron's `app`.
   */
  async start(
    github: GithubApi,
    directory: string,
    currentVersion: string
  ): Promise<UpdateDownload> {
    if (this.isRunning) {
      return this.state;
    }

    this.current = { ...IDLE, status: 'downloading' };
    this.emit('progress', this.state);

    const controller = new AbortController();
    this.controller = controller;

    try {
      const info = await checkForUpdates(currentVersion, github);
      if (info.error) {
        throw new AppError('GITHUB_ERROR', info.error);
      }
      if (!info.updateAvailable || !info.latestVersion) {
        throw new AppError('VALIDATION', 'You are already on the latest version.');
      }

      const release = await github.getLatestRelease(RELEASE_OWNER, RELEASE_REPO);
      const asset = release?.assets.find((item) => item.name.endsWith('.deb'));
      if (!asset) {
        throw new AppError('NOT_FOUND', 'That release has no .deb package attached.');
      }

      const filePath = join(directory, asset.name);
      this.update({
        version: info.latestVersion,
        fileName: asset.name,
        totalBytes: asset.size,
        percent: asset.size > 0 ? 0 : -1,
      });

      await this.stream(github, asset.id, asset.size, filePath, controller.signal);

      // The published checksums are the only way to know the bytes are the ones
      // the release workflow built.
      this.update({ status: 'verifying' });
      const expected = await this.expectedChecksum(release?.assets ?? [], asset.name, github);
      const actual = await hashFile(filePath);

      if (expected && expected !== actual) {
        await rm(filePath, { force: true });
        throw new AppError(
          'UNKNOWN',
          'The downloaded file did not match the published checksum, so it was deleted.'
        );
      }

      this.update({
        status: 'done',
        filePath,
        checksumVerified: expected !== null,
        percent: 100,
        bytesPerSecond: 0,
      });
      log.info({ filePath, verified: expected !== null }, 'update downloaded');
      return this.state;
    } catch (error) {
      const aborted = controller.signal.aborted;
      const message = errorMessage(error);
      this.update({
        status: aborted ? 'cancelled' : 'error',
        error: aborted ? null : message,
        bytesPerSecond: 0,
      });
      if (!aborted) {
        log.error({ err: message }, 'update download failed');
      }
      return this.state;
    } finally {
      this.controller = null;
    }
  }

  /** Streams the asset to disk, reporting progress as it goes. */
  private async stream(
    github: GithubApi,
    assetId: number,
    totalBytes: number,
    filePath: string,
    signal: AbortSignal
  ): Promise<void> {
    const response = await github.downloadReleaseAsset(
      RELEASE_OWNER,
      RELEASE_REPO,
      assetId,
      signal
    );
    if (!response.body) {
      throw new AppError('UNKNOWN', 'The download returned no data.');
    }

    // `content-length` is more trustworthy than the asset record for the actual
    // transfer, but either is fine for a progress bar.
    const declared = Number(response.headers.get('content-length') ?? 0);
    const total = declared > 0 ? declared : totalBytes;

    let received = 0;
    let lastEmit = 0;
    const startedAt = Date.now();

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastEmit < PROGRESS_INTERVAL_MS) {
        return;
      }
      lastEmit = now;
      const elapsed = (now - startedAt) / 1000;
      this.update({
        receivedBytes: received,
        totalBytes: total,
        percent: total > 0 ? Math.min(Math.round((received / total) * 100), 100) : -1,
        bytesPerSecond: elapsed > 0 ? Math.round(received / elapsed) : 0,
      });
    });

    await pipeline(source, createWriteStream(filePath), { signal });
    this.update({ receivedBytes: received, totalBytes: total });
  }

  /** Reads the expected hash out of the release's SHA256SUMS.txt. */
  private async expectedChecksum(
    assets: Array<{ id: number; name: string }>,
    fileName: string,
    github: GithubApi
  ): Promise<string | null> {
    const sums = assets.find((asset) => asset.name === 'SHA256SUMS.txt');
    if (!sums) {
      log.warn('the release has no SHA256SUMS.txt, skipping verification');
      return null;
    }
    try {
      const response = await github.downloadReleaseAsset(
        RELEASE_OWNER,
        RELEASE_REPO,
        sums.id,
        new AbortController().signal
      );
      const text = await response.text();
      for (const line of text.split('\n')) {
        const [hash, name] = line.trim().split(/\s+/, 2);
        if (name === fileName && hash) {
          return hash.toLowerCase();
        }
      }
      return null;
    } catch (error) {
      log.warn({ err: errorMessage(error) }, 'could not read the published checksums');
      return null;
    }
  }

  reset(): UpdateDownload {
    if (!this.isRunning) {
      this.current = { ...IDLE };
      this.emit('progress', this.state);
    }
    return this.state;
  }
}

async function hashFile(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export const updateDownloader = new UpdateDownloader();
