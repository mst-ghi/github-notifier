import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { CONTROL_HOST } from '../shared/constants';
import { errorMessage } from '../shared/errors';
import type { DaemonStatus } from '../shared/types';
import type { Engine } from './engine';
import { childLogger } from './logger';
import { CONFIG_DIR, CONTROL_TOKEN_FILE, ensureDir } from './paths';

const log = childLogger('control');

/**
 * Loopback-only control API.
 *
 * The Electron app uses this to ask the daemon for live state and to flip
 * pause/resume. It binds to 127.0.0.1 and requires a bearer token that only
 * processes able to read the user's config directory can obtain, so nothing on
 * the network can reach it.
 */

/** Reads the shared token, creating it on first run. */
export function readOrCreateControlToken(): string {
  ensureDir(CONFIG_DIR);
  if (existsSync(CONTROL_TOKEN_FILE)) {
    const existing = readFileSync(CONTROL_TOKEN_FILE, 'utf8').trim();
    if (existing.length >= 32) {
      return existing;
    }
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(CONTROL_TOKEN_FILE, token, { mode: 0o600 });
  chmodSync(CONTROL_TOKEN_FILE, 0o600);
  return token;
}

/** Reads the token without creating one. Used by the Electron client. */
export function readControlToken(): string | null {
  try {
    if (!existsSync(CONTROL_TOKEN_FILE)) {
      return null;
    }
    const token = readFileSync(CONTROL_TOKEN_FILE, 'utf8').trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface ControlServerOptions {
  port: number;
  engine: Engine;
}

export class ControlServer {
  private server: FastifyInstance | null = null;
  private token = '';

  get isListening(): boolean {
    return this.server !== null;
  }

  async start(options: ControlServerOptions): Promise<void> {
    await this.stop();
    this.token = readOrCreateControlToken();

    const server = Fastify({ logger: false, bodyLimit: 64 * 1024 });

    server.addHook('onRequest', async (request, reply) => {
      if (request.url === '/health') {
        return;
      }
      const header = request.headers.authorization ?? '';
      const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!safeCompare(provided, this.token)) {
        await reply.code(401).send({ error: 'Unauthorized' });
      }
    });

    const status = async (): Promise<DaemonStatus> => options.engine.status();

    server.get('/health', async () => ({ ok: true }));
    server.get('/status', status);

    server.post('/pause', async () => {
      await options.engine.pause();
      return status();
    });

    server.post('/resume', async () => {
      await options.engine.resume();
      return status();
    });

    server.post('/poll', async () => {
      // Fire and forget: a full poll can take longer than the client will wait.
      void options.engine.pollNow();
      return status();
    });

    server.post('/reload', async () => {
      await options.engine.reload();
      return status();
    });

    try {
      await server.listen({ port: options.port, host: CONTROL_HOST });
      this.server = server;
      log.info({ port: options.port }, 'control API listening');
    } catch (error) {
      log.error({ port: options.port, err: errorMessage(error) }, 'control API failed to start');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
  }
}

export const controlServer = new ControlServer();
