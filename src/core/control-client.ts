import { CONTROL_HOST, DEFAULT_CONTROL_PORT } from '../shared/constants';
import { errorMessage } from '../shared/errors';
import type { DaemonStatus } from '../shared/types';
import { readControlToken } from './control-server';
import { childLogger } from './logger';

const log = childLogger('control-client');

/** Placeholder returned when the daemon is not running. */
export const UNREACHABLE_STATUS: DaemonStatus = {
  reachable: false,
  version: '0.0.0',
  uptimeSeconds: 0,
  paused: false,
  dbConnected: false,
  webhookListening: false,
  webhookPort: 0,
  pollerRunning: false,
  lastPollAt: null,
  lastPollError: null,
  lastWebhookAt: null,
  authenticatedAs: null,
  rateLimit: null,
  monitoredRepoCount: 0,
};

/**
 * Talks to the daemon's control API.
 *
 * Every method degrades to `UNREACHABLE_STATUS` instead of throwing, because
 * "daemon is not running" is a normal state the UI has to render, not an error
 * worth blowing up an IPC call for.
 */
export class ControlClient {
  private port: number;

  constructor(port: number = DEFAULT_CONTROL_PORT) {
    this.port = port;
  }

  setPort(port: number): void {
    this.port = port;
  }

  private get baseUrl(): string {
    return `http://${CONTROL_HOST}:${this.port}`;
  }

  private async request(path: string, method: 'GET' | 'POST'): Promise<DaemonStatus> {
    const token = readControlToken();
    if (!token) {
      return UNREACHABLE_STATUS;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        log.warn({ path, status: response.status }, 'control API returned an error');
        return UNREACHABLE_STATUS;
      }
      const body = (await response.json()) as DaemonStatus;
      return { ...body, reachable: true };
    } catch (error) {
      log.debug({ path, err: errorMessage(error) }, 'daemon not reachable');
      return UNREACHABLE_STATUS;
    }
  }

  status(): Promise<DaemonStatus> {
    return this.request('/status', 'GET');
  }

  pause(): Promise<DaemonStatus> {
    return this.request('/pause', 'POST');
  }

  resume(): Promise<DaemonStatus> {
    return this.request('/resume', 'POST');
  }

  pollNow(): Promise<DaemonStatus> {
    return this.request('/poll', 'POST');
  }

  reload(): Promise<DaemonStatus> {
    return this.request('/reload', 'POST');
  }
}

export const controlClient = new ControlClient();
