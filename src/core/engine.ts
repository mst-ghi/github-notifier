import { readFileSync } from 'node:fs';
import { errorMessage } from '../shared/errors';
import type { DaemonStatus } from '../shared/types';
import { database, syncIndexes } from './database';
import { eventProcessor } from './event-processor';
import { github } from './github-api';
import { childLogger } from './logger';
import { markDelivered } from './notification-service';
import { DesktopNotifier, openExternal } from './notifier';
import { ensureAppDirs } from './paths';
import { Poller } from './poller';
import { monitoredRepoCount } from './repo-service';
import { secrets } from './secrets';
import { getSettings, setAuthenticatedUser, updateSettings } from './settings-service';
import { webhookServer } from './webhook-server';

const log = childLogger('engine');

/**
 * Wires every subsystem together and owns their lifecycle.
 *
 * The daemon runs one of these. The Electron app never does — it talks to the
 * daemon over the control API instead, so there is exactly one webhook
 * listener, one poller and one source of desktop toasts no matter how many
 * times the user opens and closes the window.
 */
export class Engine {
  private readonly notifier = new DesktopNotifier();
  private readonly poller = new Poller({ github, processor: eventProcessor });
  private startedAt = Date.now();
  private paused = false;
  private started = false;
  /** Last token handed to Octokit, so reload() can spot a real change. */
  private appliedToken: string | null = null;
  private appliedWebhookSecret: string | null = null;

  get desktopNotifier(): DesktopNotifier {
    return this.notifier;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.startedAt = Date.now();
    ensureAppDirs();

    // Mongo first: everything else reads settings from it.
    await database.connect();
    await syncIndexes();

    const settings = await getSettings();
    this.paused = settings.paused;

    this.notifier.configure({
      soundEnabled: settings.soundEnabled,
      onActivate: (notification) => openExternal(notification.url),
    });

    eventProcessor.on('notification', (notification) => {
      void (async () => {
        const current = await getSettings();
        if (!current.notificationsEnabled || this.paused) {
          return;
        }
        this.notifier.show(notification);
        await markDelivered(notification.id);
      })();
    });

    await this.applyToken();
    await this.startWebhookServer();
    await this.poller.start();

    log.info({ paused: this.paused }, 'engine started');
  }

  /** Loads the token from the keyring and records who it belongs to. */
  private async applyToken(): Promise<void> {
    const token = secrets.getToken();
    this.appliedToken = token;
    if (!token) {
      log.warn('no GitHub token configured; the engine will idle until one is set');
      github.setToken(null);
      eventProcessor.setCurrentUser('');
      return;
    }
    github.setToken(token);
    const validation = await github.validateToken();
    if (!validation.valid || !validation.user) {
      log.error({ err: validation.error }, 'GitHub token rejected');
      return;
    }
    eventProcessor.setCurrentUser(validation.user.login);
    await setAuthenticatedUser(validation.user.login);
    if (validation.missingScopes.length > 0) {
      log.warn({ missing: validation.missingScopes }, 'token is missing recommended scopes');
    }
    log.info({ user: validation.user.login }, 'authenticated with GitHub');
  }

  private async startWebhookServer(): Promise<void> {
    const settings = await getSettings();
    const secret = secrets.getWebhookSecret();
    this.appliedWebhookSecret = secret;
    if (!secret) {
      log.warn('no webhook secret set; webhook receiver disabled (polling still works)');
      return;
    }
    try {
      await webhookServer.start({
        port: settings.webhookPort,
        secret,
        onDelivery: async (delivery, deliveryId) => {
          log.debug({ deliveryId, event: delivery.name }, 'webhook delivery received');
          await eventProcessor.handleWebhook(delivery);
        },
      });
    } catch (error) {
      log.error(
        { port: settings.webhookPort, err: errorMessage(error) },
        'webhook server failed to start'
      );
    }
  }

  /** Re-reads settings and secrets. Called after the UI changes anything. */
  async reload(): Promise<void> {
    const settings = await getSettings();
    this.paused = settings.paused;
    this.notifier.configure({ soundEnabled: settings.soundEnabled });

    // Compare the token itself, not just "is a client configured": replacing
    // one valid token with another must re-authenticate, and revalidating on
    // every unrelated settings change would waste an API call each time.
    if (secrets.getToken() !== this.appliedToken) {
      await this.applyToken();
    }

    const secretChanged = secrets.getWebhookSecret() !== this.appliedWebhookSecret;
    if (
      secretChanged ||
      settings.webhookPort !== webhookServer.port ||
      !webhookServer.isListening
    ) {
      await webhookServer.stop();
      await this.startWebhookServer();
    }

    await this.poller.restart();
    log.info('engine reloaded');
  }

  async pause(): Promise<void> {
    this.paused = true;
    await updateSettings({ paused: true });
    log.info('monitoring paused');
  }

  async resume(): Promise<void> {
    this.paused = false;
    await updateSettings({ paused: false });
    log.info('monitoring resumed');
  }

  async pollNow(): Promise<void> {
    await this.poller.pollNow();
  }

  async status(): Promise<DaemonStatus> {
    const settings = database.isConnected ? await getSettings() : null;
    return {
      reachable: true,
      version: readVersion(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      paused: this.paused,
      mongoConnected: database.isConnected,
      webhookListening: webhookServer.isListening,
      webhookPort: settings?.webhookPort ?? 0,
      pollerRunning: this.poller.isRunning,
      lastPollAt: this.poller.lastPoll?.toISOString() ?? null,
      lastPollError: this.poller.lastPollError,
      lastWebhookAt: webhookServer.lastDelivery?.toISOString() ?? null,
      authenticatedAs: eventProcessor.user || null,
      rateLimit: github.isReady ? github.queue.info : null,
      monitoredRepoCount: await monitoredRepoCount(),
    };
  }

  async stop(): Promise<void> {
    this.poller.stop();
    await webhookServer.stop();
    await database.disconnect();
    this.started = false;
    log.info('engine stopped');
  }
}

let cachedVersion: string | null = null;

function readVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }
  try {
    const pkg: unknown = JSON.parse(
      readFileSync(new URL('../../package.json', `file://${__filename}`), 'utf8')
    );
    cachedVersion =
      typeof pkg === 'object' && pkg !== null && 'version' in pkg
        ? String((pkg as { version: unknown }).version)
        : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

export const engine = new Engine();
