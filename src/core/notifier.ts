import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import notifier from 'node-notifier';
import { APP_NAME } from '../shared/constants';
import { errorMessage } from '../shared/errors';
import { EVENT_LABELS } from '../shared/format';
import type { AppNotification, NotificationSeverity } from '../shared/types';
import { childLogger } from './logger';

const log = childLogger('notifier');
const execFileAsync = promisify(execFile);

/**
 * Desktop notifications for Linux.
 *
 * Preferred path is `notify-send --action`, because that is the only way to get
 * a *clickable* notification that works the same on GNOME, KDE, XFCE and
 * anything else speaking the freedesktop notification spec. libnotify 0.8+ (in
 * Debian 13) prints the activated action id on stdout, which is what lets us
 * open the pull request in a browser.
 *
 * If `notify-send` is missing or too old we fall back to node-notifier, which
 * still shows the toast but cannot report clicks.
 */

type Urgency = 'low' | 'normal' | 'critical';

const URGENCY_BY_SEVERITY: Readonly<Record<NotificationSeverity, Urgency>> = {
  info: 'normal',
  success: 'normal',
  warning: 'normal',
  error: 'critical',
};

const ICON_BY_SEVERITY: Readonly<Record<NotificationSeverity, string>> = {
  info: 'dialog-information',
  success: 'emblem-default',
  warning: 'dialog-warning',
  error: 'dialog-error',
};

export interface NotifierOptions {
  /** Absolute path to a PNG used as the toast icon. Falls back to a theme icon. */
  iconPath?: string;
  /** Called when the user clicks the toast. Defaults to opening the URL. */
  onActivate?: (notification: AppNotification) => void;
  soundEnabled?: boolean;
}

let notifySendSupport: 'unknown' | 'actions' | 'basic' | 'missing' = 'unknown';

/** Probes once whether `notify-send` exists and understands `--action`. */
async function probeNotifySend(): Promise<void> {
  if (notifySendSupport !== 'unknown') {
    return;
  }
  try {
    const { stdout } = await execFileAsync('notify-send', ['--version']);
    const match = /(\d+)\.(\d+)/.exec(stdout);
    const major = match ? Number(match[1]) : 0;
    const minor = match ? Number(match[2]) : 0;
    notifySendSupport = major > 0 || minor >= 8 ? 'actions' : 'basic';
    log.debug({ version: stdout.trim(), support: notifySendSupport }, 'notify-send probed');
  } catch {
    notifySendSupport = 'missing';
    log.warn('notify-send not found, using node-notifier fallback');
  }
}

/** Opens a URL in the user's default browser. */
export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    log.warn({ url }, 'refusing to open non-http URL');
    return;
  }
  const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', (error) => {
    log.error({ url, err: errorMessage(error) }, 'xdg-open failed');
  });
  child.unref();
}

function resolveIcon(iconPath?: string): string | null {
  if (iconPath && existsSync(iconPath)) {
    return iconPath;
  }
  // Installed by the .deb; present when running from a packaged build.
  const packaged = '/opt/GitHub Notifier/resources/build/icons/512x512.png';
  return existsSync(packaged) ? packaged : null;
}

export class DesktopNotifier {
  private options: NotifierOptions;
  /** Caps concurrent notify-send processes so an event burst cannot fork-bomb. */
  private inFlight = 0;
  private readonly maxInFlight = 3;
  private readonly pending: AppNotification[] = [];

  constructor(options: NotifierOptions = {}) {
    this.options = options;
  }

  configure(options: NotifierOptions): void {
    this.options = { ...this.options, ...options };
  }

  /** Queues a desktop toast. Never throws: a failed toast must not stop the daemon. */
  show(notification: AppNotification): void {
    this.pending.push(notification);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.inFlight >= this.maxInFlight) {
      return;
    }
    const next = this.pending.shift();
    if (!next) {
      return;
    }
    this.inFlight += 1;
    try {
      await this.dispatch(next);
    } catch (error) {
      log.error({ err: errorMessage(error), id: next.id }, 'failed to show notification');
    } finally {
      this.inFlight -= 1;
      void this.drain();
    }
  }

  private activate(notification: AppNotification): void {
    if (this.options.onActivate) {
      this.options.onActivate(notification);
    } else {
      openExternal(notification.url);
    }
  }

  private async dispatch(notification: AppNotification): Promise<void> {
    await probeNotifySend();
    const title = `${EVENT_LABELS[notification.eventType]} · ${notification.repoName}`;
    const body =
      notification.prNumber !== null
        ? `#${notification.prNumber} ${notification.message}`
        : notification.message;

    if (notifySendSupport === 'missing') {
      this.dispatchViaNodeNotifier(title, body, notification);
      return;
    }

    const icon = resolveIcon(this.options.iconPath) ?? ICON_BY_SEVERITY[notification.severity];
    const args = [
      '--app-name',
      APP_NAME,
      '--icon',
      icon,
      '--urgency',
      URGENCY_BY_SEVERITY[notification.severity],
      '--category',
      'vcs.update',
      '--hint',
      'string:desktop-entry:github-notifier',
      // Same tag replaces an earlier toast for the same PR instead of stacking.
      '--hint',
      `string:x-canonical-private-synchronous:${notification.repoName}#${notification.prNumber ?? 0}`,
    ];

    if (this.options.soundEnabled) {
      args.push('--hint', 'string:sound-name:message-new-instant');
    }

    if (notifySendSupport === 'actions') {
      // `default` fires on a plain click on the toast body.
      args.push('--action', 'default=Open in browser', '--wait');
    }

    args.push(title, body);

    await new Promise<void>((resolve) => {
      const child = spawn('notify-send', args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        log.error({ err: errorMessage(error) }, 'notify-send failed, falling back');
        notifySendSupport = 'missing';
        this.dispatchViaNodeNotifier(title, body, notification);
        resolve();
      });
      child.on('close', () => {
        if (stdout.trim() === 'default') {
          this.activate(notification);
        }
        resolve();
      });
    });
  }

  private dispatchViaNodeNotifier(
    title: string,
    body: string,
    notification: AppNotification
  ): void {
    notifier.notify(
      {
        title,
        message: body,
        icon: resolveIcon(this.options.iconPath) ?? undefined,
        wait: true,
        timeout: 10,
      },
      (error) => {
        if (error) {
          log.error({ err: errorMessage(error) }, 'node-notifier failed');
        }
      }
    );
    notifier.removeAllListeners('click');
    notifier.on('click', () => this.activate(notification));
  }
}

/** Path of the tray/toast icon inside a packaged build. */
export function packagedIconPath(resourcesPath: string): string {
  return join(resourcesPath, 'build', 'icons', '512x512.png');
}

export const desktopNotifier = new DesktopNotifier();
