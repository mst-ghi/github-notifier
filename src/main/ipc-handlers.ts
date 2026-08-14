import { app, clipboard, ipcMain, shell } from 'electron';
import { controlClient } from '../core/control-client';
import { db } from '../core/db/sqlite';
import { github } from '../core/github-api';
import { childLogger } from '../core/logger';
import {
  clearAllNotifications,
  deleteNotifications,
  getNotification,
  markAllRead,
  markRead,
  notificationStats,
  pruneOldNotifications,
  queryNotifications,
  repoFacets,
  unreadCount,
} from '../core/notification-service';
import { getProfileOverview } from '../core/profile-service';
import {
  cachedCounts,
  getPullRequestDetail,
  getPullRequestDetailByRef,
  getRepo,
  listActiveRepos,
  listOpenPullRequests,
  refreshCounts,
} from '../core/pull-request-service';
import {
  installWebhook,
  listRepos,
  removeWebhook,
  setMonitoring,
  syncReposFromGithub,
  updateRepo,
} from '../core/repo-service';
import { secrets } from '../core/secrets';
import { getSettings, setAuthenticatedUser, updateSettings } from '../core/settings-service';
import { checkForUpdates } from '../core/updater';
import { AppError } from '../shared/errors';
import type { IpcArgs, IpcChannel, IpcResponse, IpcResult, TokenValidation } from '../shared/types';
import { getMainWindow, hideMainWindow, sendToRenderer } from './window';

const log = childLogger('ipc');
const isDev = process.env.NODE_ENV === 'development';

/**
 * Every channel must appear here. `IpcHandlerMap` is derived from the shared
 * `IpcRequestMap`, so a channel added to the contract without a handler (or
 * with the wrong argument types) fails the build instead of failing at runtime.
 */
type IpcHandlerMap = {
  [C in IpcChannel]: (...args: IpcArgs<C>) => Promise<IpcResult<C>> | IpcResult<C>;
};

/** Refreshes the unread badge everywhere after any mutation. */
async function broadcastUnread(): Promise<number> {
  const count = unreadCount();
  sendToRenderer('event:unreadCount', count);
  return count;
}

/** Asks the daemon to re-read settings. Silently ignored when it is not running. */
async function nudgeDaemon(): Promise<void> {
  await controlClient.reload();
}

async function applyToken(token: string): Promise<TokenValidation> {
  const trimmed = token.trim();
  if (trimmed.length < 20) {
    throw new AppError('VALIDATION', 'That does not look like a GitHub token.');
  }

  const validation = await github.validateToken(trimmed);
  if (!validation.valid || !validation.user) {
    throw new AppError('BAD_TOKEN', validation.error ?? 'GitHub rejected the token.');
  }

  secrets.setToken(trimmed);
  github.setToken(trimmed);
  setAuthenticatedUser(validation.user.login);
  await nudgeDaemon();
  log.info({ user: validation.user.login }, 'GitHub token stored');
  return validation;
}

const handlers: IpcHandlerMap = {
  /* --- settings --- */
  'settings:get': () => getSettings(),

  'settings:update': async (update) => {
    const settings = updateSettings(update);
    await nudgeDaemon();
    return settings;
  },

  'settings:setToken': (token) => applyToken(token),

  'settings:clearToken': async () => {
    secrets.clearToken();
    github.setToken(null);
    setAuthenticatedUser(null);
    await nudgeDaemon();
    return null;
  },

  'settings:validateToken': () => github.validateToken(),

  'settings:setWebhookSecret': async (secret) => {
    if (secret.trim().length < 16) {
      throw new AppError('VALIDATION', 'The webhook secret must be at least 16 characters.');
    }
    secrets.setWebhookSecret(secret);
    await nudgeDaemon();
    return null;
  },

  'settings:generateWebhookSecret': async () => {
    const secret = secrets.generateWebhookSecret();
    await nudgeDaemon();
    return secret;
  },

  /* --- repos --- */
  'repos:list': () => listRepos(),

  'repos:sync': async () => {
    const repos = await syncReposFromGithub(github);
    sendToRenderer('event:reposChanged', repos);
    return repos;
  },

  'repos:update': async (repoId, update) => {
    const repo = await updateRepo(repoId, update);
    await nudgeDaemon();
    return repo;
  },

  'repos:setMonitoring': async (repoId, enabled) => {
    const repo = await setMonitoring(repoId, enabled);
    await nudgeDaemon();
    return repo;
  },

  'repos:installWebhook': async (repoId) => {
    const repo = await installWebhook(github, repoId);
    await nudgeDaemon();
    return repo;
  },

  'repos:removeWebhook': async (repoId) => {
    const repo = await removeWebhook(github, repoId);
    await nudgeDaemon();
    return repo;
  },

  'repos:get': (repoId) => getRepo(repoId),
  'repos:listActive': () => listActiveRepos(),

  /* --- pull requests --- */
  'pulls:list': async (repoId) => {
    const pulls = await listOpenPullRequests(github, repoId);
    // Fetching the list also corrected the cached count, so push the new total.
    sendToRenderer('event:pullCounts', cachedCounts());
    return pulls;
  },

  'pulls:get': (repoId, number) => getPullRequestDetail(github, repoId, number),

  'pulls:getByRef': (owner, repo, number) => getPullRequestDetailByRef(github, owner, repo, number),

  /* --- profile --- */
  'profile:overview': () => getProfileOverview(github),

  'pulls:counts': async () => {
    const counts = await refreshCounts(github);
    return counts;
  },

  'pulls:refreshCounts': async () => {
    const counts = await refreshCounts(github, { force: true });
    sendToRenderer('event:pullCounts', counts);
    return counts;
  },

  /* --- notifications --- */
  'notifications:query': (query) => queryNotifications(query),
  'notifications:get': (id) => getNotification(id),

  'notifications:markRead': async (ids) => {
    const changed = markRead(ids);
    await broadcastUnread();
    return changed;
  },

  'notifications:markAllRead': async () => {
    const changed = markAllRead();
    await broadcastUnread();
    return changed;
  },

  'notifications:delete': async (ids) => {
    const removed = deleteNotifications(ids);
    await broadcastUnread();
    return removed;
  },

  'notifications:clearAll': async () => {
    const removed = clearAllNotifications();
    await broadcastUnread();
    return removed;
  },

  'notifications:unreadCount': () => unreadCount(),
  'notifications:repoFacets': () => repoFacets(),
  'notifications:stats': () => notificationStats(getSettings().retentionDays),

  'notifications:pruneNow': async (days) => {
    const removed = pruneOldNotifications(days ?? getSettings().retentionDays);
    await broadcastUnread();
    return removed;
  },

  /* --- daemon --- */
  'daemon:status': () => controlClient.status(),

  'daemon:pause': async () => {
    const status = await controlClient.pause();
    sendToRenderer('event:status', status);
    return status;
  },

  'daemon:resume': async () => {
    const status = await controlClient.resume();
    sendToRenderer('event:status', status);
    return status;
  },

  'daemon:pollNow': () => controlClient.pollNow(),
  'daemon:reloadSettings': () => controlClient.reload(),

  /* --- shell --- */
  'shell:openExternal': async (url) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new AppError('VALIDATION', 'Only http and https links can be opened.');
    }
    await shell.openExternal(url);
    return null;
  },

  'app:version': () => app.getVersion(),

  'app:copyToClipboard': (text) => {
    clipboard.writeText(text);
    return null;
  },

  'app:checkForUpdates': () => checkForUpdates(app.getVersion(), github),

  'app:dbConnected': () => db.isOpen,

  /* --- custom window frame --- */
  'window:minimizeToTray': () => {
    hideMainWindow();
    return null;
  },

  'window:minimize': () => {
    getMainWindow()?.minimize();
    return null;
  },

  'window:toggleMaximize': () => {
    const window = getMainWindow();
    if (!window) {
      return false;
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return window.isMaximized();
  },

  // Same as the OS close button: hide to the tray rather than quit, so the
  // daemon keeps notifying.
  'window:close': () => {
    hideMainWindow();
    return null;
  },

  'window:isMaximized': () => getMainWindow()?.isMaximized() ?? false,

  'window:getBounds': () => getMainWindow()?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 },

  'window:setBounds': (bounds) => {
    const window = getMainWindow();
    // Ignore resize requests while maximised; the drag would fight the WM.
    if (window && !window.isMaximized()) {
      window.setBounds(bounds);
    }
    return null;
  },
};

/** Wires the handler map into Electron. Call once, after `app.whenReady()`. */
export function registerIpcHandlers(): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResponse<unknown>> => {
      try {
        // The cast is confined to this one line; every call site above is typed.
        const handler = handlers[channel] as (...a: unknown[]) => Promise<unknown> | unknown;
        const data = await handler(...args);
        return { ok: true, data };
      } catch (error) {
        const appError = AppError.from(error);
        log.error({ channel, code: appError.code, err: appError.message }, 'IPC handler failed');
        return { ok: false, error: appError.toPayload(isDev) };
      }
    });
  }
  log.info({ channels: Object.keys(handlers).length }, 'IPC handlers registered');
}

export { broadcastUnread };
