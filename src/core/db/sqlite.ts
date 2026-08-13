import { existsSync } from 'node:fs';
import { join } from 'node:path';
import SqliteDatabase, { type Database as SqliteHandle } from 'better-sqlite3';
import { AppError, errorMessage } from '../../shared/errors';
import { childLogger } from '../logger';
import { DATA_DIR, ensureDir } from '../paths';
import { LATEST_VERSION, MIGRATIONS } from './migrations';

const log = childLogger('sqlite');

/** Default on-disk location. Override with `GHN_DB_PATH` for tests. */
export function defaultDatabasePath(): string {
  return process.env.GHN_DB_PATH ?? join(DATA_DIR, 'github-notifier.db');
}

/**
 * The SQLite connection.
 *
 * Two processes use this file at once — the daemon writes, the window reads and
 * edits — so WAL is not optional: it is what lets a reader run while a writer
 * holds the file. `busy_timeout` covers the brief moments when both want to
 * write, which is far cheaper than either side implementing its own retry.
 *
 * better-sqlite3 is synchronous. That is a feature here: no query can interleave
 * with another, so there are no half-applied writes to reason about.
 */
class Db {
  private handle: SqliteHandle | null = null;
  private path = '';
  private lastError: string | null = null;

  get isOpen(): boolean {
    return this.handle?.open === true;
  }

  get file(): string {
    return this.path;
  }

  get error(): string | null {
    return this.lastError;
  }

  /** Opens the database and runs any pending migrations. Idempotent. */
  open(path: string = defaultDatabasePath()): SqliteHandle {
    if (this.handle?.open && this.path === path) {
      return this.handle;
    }
    this.close();
    ensureDir(DATA_DIR);

    const isNew = !existsSync(path);
    try {
      const handle = new SqliteDatabase(path, { timeout: 5000 });

      handle.pragma('journal_mode = WAL');
      // NORMAL is the right trade-off under WAL: durable across app crashes,
      // and only at risk in a power loss, which for a notification cache is
      // an acceptable loss.
      handle.pragma('synchronous = NORMAL');
      handle.pragma('foreign_keys = ON');
      handle.pragma('busy_timeout = 5000');
      // Keeps the WAL from growing without bound on a process that runs for
      // weeks between restarts.
      handle.pragma('wal_autocheckpoint = 512');

      this.handle = handle;
      this.path = path;
      this.lastError = null;

      this.migrate(handle);
      log.info({ path, created: isNew, version: LATEST_VERSION }, 'database ready');
      return handle;
    } catch (error) {
      this.lastError = errorMessage(error);
      log.error({ path, err: this.lastError }, 'failed to open database');
      throw new AppError('DB_UNAVAILABLE', `Could not open the database: ${this.lastError}`, error);
    }
  }

  /**
   * Applies migrations newer than the file's `user_version`.
   *
   * Each one runs inside a transaction together with the version bump, so a
   * migration that throws leaves the file exactly as it was.
   */
  private migrate(handle: SqliteHandle): void {
    const current = Number(handle.pragma('user_version', { simple: true }));
    if (current > LATEST_VERSION) {
      throw new AppError(
        'DB_UNAVAILABLE',
        `The database was written by a newer version of the app (schema ${current}, this build understands ${LATEST_VERSION}).`
      );
    }

    for (const migration of MIGRATIONS.filter((m) => m.version > current)) {
      log.info({ version: migration.version, name: migration.name }, 'applying migration');
      const run = handle.transaction(() => {
        migration.up(handle);
        handle.pragma(`user_version = ${migration.version}`);
      });
      run();
    }
  }

  /** The open handle, or a typed error the UI can render. */
  get connection(): SqliteHandle {
    if (!this.handle?.open) {
      throw new AppError(
        'DB_UNAVAILABLE',
        'The local database is not open. Restart the app; if it persists, check permissions on ~/.local/share/github-notifier.'
      );
    }
    return this.handle;
  }

  assertOpen(): void {
    void this.connection;
  }

  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: () => T): T {
    return this.connection.transaction(fn)();
  }

  /** Reclaims space and refreshes query-planner statistics. */
  maintain(): void {
    if (!this.isOpen) {
      return;
    }
    try {
      this.connection.pragma('wal_checkpoint(TRUNCATE)');
      this.connection.exec('PRAGMA optimize');
    } catch (error) {
      log.warn({ err: errorMessage(error) }, 'maintenance failed');
    }
  }

  /** Bytes on disk, for the settings screen. Returns 0 when unavailable. */
  sizeBytes(): number {
    if (!this.isOpen) {
      return 0;
    }
    try {
      const pageCount = Number(this.connection.pragma('page_count', { simple: true }));
      const pageSize = Number(this.connection.pragma('page_size', { simple: true }));
      return pageCount * pageSize;
    } catch {
      return 0;
    }
  }

  close(): void {
    if (this.handle?.open) {
      try {
        this.handle.pragma('wal_checkpoint(TRUNCATE)');
        this.handle.close();
      } catch (error) {
        log.warn({ err: errorMessage(error) }, 'error while closing the database');
      }
    }
    this.handle = null;
  }
}

export const db = new Db();

/** SQLite has no boolean type; these keep the conversion in one place. */
export function toSqlBool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function fromSqlBool(value: number): boolean {
  return value !== 0;
}

/** Timestamps are stored as ISO-8601 strings so they sort lexicographically. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Escapes `%` and `_` so user input cannot act as LIKE wildcards. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
