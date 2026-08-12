import mongoose, { type Connection } from 'mongoose';
import { DEFAULT_MONGO_DB, DEFAULT_MONGO_URI } from '../shared/constants';
import { AppError, errorMessage } from '../shared/errors';
import { childLogger } from './logger';

const log = childLogger('database');

export interface DatabaseOptions {
  uri?: string;
  dbName?: string;
  /** Milliseconds between reconnect attempts. Backs off up to 30s. */
  retryBaseDelayMs?: number;
}

export type DatabaseState = 'disconnected' | 'connecting' | 'connected';

/**
 * Wraps the single global Mongoose connection.
 *
 * Mongoose already retries internally, but it gives up on the *initial*
 * connection, which is exactly the case that matters when the daemon starts
 * before mongod. So we drive our own retry loop for the first connect and let
 * the driver handle reconnects after that.
 */
class Database {
  private state: DatabaseState = 'disconnected';
  private connectPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryAttempt = 0;
  private stopped = false;
  private options: Required<DatabaseOptions> = {
    uri: process.env.MONGO_URI ?? DEFAULT_MONGO_URI,
    dbName: process.env.MONGO_DB ?? DEFAULT_MONGO_DB,
    retryBaseDelayMs: 2000,
  };

  get isConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  get currentState(): DatabaseState {
    return this.state;
  }

  get connection(): Connection {
    return mongoose.connection;
  }

  configure(options: DatabaseOptions): void {
    this.options = { ...this.options, ...options };
  }

  /** Resolves once connected. Keeps retrying in the background until it is. */
  async connect(options: DatabaseOptions = {}): Promise<void> {
    this.configure(options);
    this.stopped = false;
    if (this.isConnected) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.connectWithRetry();
    }
    return this.connectPromise;
  }

  private async connectWithRetry(): Promise<void> {
    this.attachListeners();
    // Retry loop; the only ways out are a successful connect or stop().
    for (;;) {
      if (this.stopped) {
        throw new AppError('DB_UNAVAILABLE', 'Database connection was stopped');
      }
      try {
        this.state = 'connecting';
        await mongoose.connect(this.options.uri, {
          dbName: this.options.dbName,
          authSource: 'admin',
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          maxPoolSize: 10,
          minPoolSize: 1,
          // Keeps a long-lived daemon from holding idle sockets open forever.
          maxIdleTimeMS: 60000,
          heartbeatFrequencyMS: 10000,
          retryWrites: true,
        });
        this.state = 'connected';
        this.retryAttempt = 0;
        log.info({ db: this.options.dbName }, 'connected to MongoDB');
        return;
      } catch (error) {
        this.state = 'disconnected';
        this.retryAttempt += 1;
        const delay = Math.min(this.options.retryBaseDelayMs * 2 ** (this.retryAttempt - 1), 30000);
        log.error(
          { attempt: this.retryAttempt, delayMs: delay, err: errorMessage(error) },
          'MongoDB connection failed, retrying'
        );
        await this.sleep(delay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.retryTimer = setTimeout(resolve, ms);
      this.retryTimer.unref?.();
    });
  }

  private listenersAttached = false;

  private attachListeners(): void {
    if (this.listenersAttached) {
      return;
    }
    this.listenersAttached = true;
    mongoose.connection.on('connected', () => {
      this.state = 'connected';
      log.info('MongoDB connection established');
    });
    mongoose.connection.on('disconnected', () => {
      this.state = 'disconnected';
      log.warn('MongoDB disconnected, driver will retry');
    });
    mongoose.connection.on('reconnected', () => {
      this.state = 'connected';
      log.info('MongoDB reconnected');
    });
    mongoose.connection.on('error', (error: unknown) => {
      log.error({ err: errorMessage(error) }, 'MongoDB error');
    });
  }

  /** Throws a typed error instead of letting a query hang when Mongo is down. */
  assertConnected(): void {
    if (!this.isConnected) {
      throw new AppError(
        'DB_UNAVAILABLE',
        'MongoDB is not reachable. Check that mongod is running on localhost:27017.'
      );
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.connectPromise = null;
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    this.state = 'disconnected';
  }
}

export const database = new Database();

/** Ensures indexes for every registered model. Safe to call repeatedly. */
export async function syncIndexes(): Promise<void> {
  const names = Object.keys(mongoose.models);
  await Promise.all(
    names.map(async (name) => {
      try {
        await mongoose.models[name].syncIndexes();
      } catch (error) {
        log.warn({ model: name, err: errorMessage(error) }, 'index sync failed');
      }
    })
  );
  log.debug({ models: names }, 'indexes synced');
}
