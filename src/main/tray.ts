import { join } from 'node:path';
import { Menu, type MenuItemConstructorOptions, Tray, app, nativeImage } from 'electron';
import { controlClient } from '../core/control-client';
import { childLogger } from '../core/logger';
import { unreadCount } from '../core/notification-service';
import { errorMessage } from '../shared/errors';
import { badgeText } from '../shared/format';
import type { DaemonStatus } from '../shared/types';
import { markQuitting, sendToRenderer, showMainWindow } from './window';

const log = childLogger('tray');

/** How often the tray refreshes its badge and daemon status, in ms. */
const REFRESH_INTERVAL_MS = 15_000;

let tray: Tray | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let lastStatus: DaemonStatus | null = null;
let lastUnread = 0;

function iconPath(name: string): string {
  return join(app.getAppPath(), 'build', name);
}

/**
 * The tray icon, badged when anything is unread.
 *
 * Two pre-rendered PNGs rather than compositing at runtime: `nativeImage` has
 * no drawing API, and a red dot burned into the asset looks identical on every
 * desktop, including the ones that ignore `setTitle`.
 */
function trayImage(unread: number): Electron.NativeImage {
  const name = unread > 0 ? 'tray-badge.png' : 'tray.png';
  const image = nativeImage.createFromPath(iconPath(name));
  if (!image.isEmpty()) {
    return image;
  }
  // A missing tray asset must not mean an invisible tray entry.
  return nativeImage.createFromPath(iconPath('icons/32x32.png'));
}

/** Remembers what is on screen so the icon is only swapped when it changes. */
let badgeShown = false;

function applyTrayIcon(target: Tray, unread: number): void {
  const wantBadge = unread > 0;
  if (wantBadge !== badgeShown) {
    target.setImage(trayImage(unread));
    badgeShown = wantBadge;
  }
}

function navigate(route: '/' | '/notifications' | '/settings'): void {
  showMainWindow();
  sendToRenderer('event:navigate', { route });
}

function buildMenu(unread: number, status: DaemonStatus | null): Menu {
  const paused = status?.paused ?? false;
  const badge = badgeText(unread);

  const statusLine = !status?.reachable
    ? 'Background service: not running'
    : status.dbConnected
      ? `Watching ${status.monitoredRepoCount} repositories`
      : 'MongoDB unreachable';

  const template: MenuItemConstructorOptions[] = [
    { label: 'GitHub Notifier', enabled: false },
    { label: statusLine, enabled: false },
    { type: 'separator' },
    {
      label: 'Open app',
      accelerator: 'CommandOrControl+O',
      click: () => navigate('/'),
    },
    {
      label: badge ? `View notifications  (${badge})` : 'View notifications',
      click: () => navigate('/notifications'),
    },
    {
      label: 'Mark all as read',
      enabled: unread > 0,
      click: () => {
        void (async () => {
          const { markAllRead } = await import('../core/notification-service');
          markAllRead();
          await refreshTray();
          sendToRenderer('event:unreadCount', 0);
        })();
      },
    },
    { type: 'separator' },
    {
      label: paused ? 'Resume monitoring' : 'Pause monitoring',
      click: () => {
        void (async () => {
          const next = paused ? await controlClient.resume() : await controlClient.pause();
          lastStatus = next;
          sendToRenderer('event:status', next);
          await refreshTray();
        })();
      },
    },
    {
      label: 'Check for updates now',
      enabled: status?.reachable ?? false,
      click: () => {
        void controlClient.pollNow();
      },
    },
    { type: 'separator' },
    { label: 'Settings…', click: () => navigate('/settings') },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: 'CommandOrControl+Q',
      click: () => {
        markQuitting();
        app.quit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

/** Re-reads unread count and daemon status, then rebuilds the menu. */
export async function refreshTray(): Promise<void> {
  if (!tray) {
    return;
  }
  try {
    const [unread, status] = [unreadCount(), await controlClient.status()];
    lastUnread = unread;
    lastStatus = status;

    applyTrayIcon(tray, unread);
    tray.setContextMenu(buildMenu(unread, status));
    const badge = badgeText(unread);
    tray.setToolTip(
      badge ? `GitHub Notifier — ${badge} unread` : 'GitHub Notifier — no unread notifications'
    );
    // Some Linux trays render the title next to the icon; where they do not,
    // this is simply ignored.
    tray.setTitle(badge);
  } catch (error) {
    log.warn({ err: errorMessage(error) }, 'tray refresh failed');
  }
}

export function createTray(): Tray {
  if (tray) {
    return tray;
  }
  tray = new Tray(trayImage(0));
  tray.setContextMenu(buildMenu(0, null));
  tray.setToolTip('GitHub Notifier');

  // Left click behaves like "open the app" on desktops that forward it.
  tray.on('click', () => {
    showMainWindow();
  });

  refreshTimer = setInterval(() => {
    void refreshTray();
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();

  void refreshTray();
  log.info('tray created');
  return tray;
}

/** Applies a fresh unread count without waiting for the next poll. */
export function setTrayUnread(unread: number): void {
  lastUnread = unread;
  if (tray) {
    applyTrayIcon(tray, unread);
    tray.setContextMenu(buildMenu(unread, lastStatus));
    tray.setTitle(badgeText(unread));
  }
}

export function currentUnread(): number {
  return lastUnread;
}

export function destroyTray(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  tray?.destroy();
  tray = null;
}
