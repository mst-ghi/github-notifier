import { app } from 'electron';
import { controlClient } from '../core/control-client';
import { db } from '../core/db/sqlite';
import { github } from '../core/github-api';
import { logger } from '../core/logger';
import { ensureAppDirs } from '../core/paths';
import { secrets } from '../core/secrets';
import { getSettings } from '../core/settings-service';
import { APP_ID } from '../shared/constants';
import { errorMessage } from '../shared/errors';
import { broadcastUnread, registerIpcHandlers } from './ipc-handlers';
import { createTray, destroyTray, refreshTray } from './tray';
import { createMainWindow, markQuitting, sendToRenderer, showMainWindow } from './window';

/**
 * Electron entry point.
 *
 * The GUI deliberately does *not* run the engine. It reads and writes MongoDB
 * directly for the things the user edits, and asks the daemon over the control
 * API for anything live. Closing the window therefore changes nothing about
 * whether notifications keep arriving.
 */

process.env.APP_COMPONENT = 'gui';
const log = logger.child({ component: 'gui' });

app.setAppUserModelId(APP_ID);
// Chromium's shared-memory sandbox trips over some Linux setups; the app has
// no untrusted renderer content, and contextIsolation is still on.
app.commandLine.appendSwitch('disable-features', 'MediaSessionService');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.info('another instance is already running, exiting');
  app.quit();
}

app.on('second-instance', () => {
  showMainWindow();
});

/** Pushes the daemon status to the renderer and tray on a slow timer. */
let statusTimer: NodeJS.Timeout | null = null;

async function pushStatus(): Promise<void> {
  try {
    const status = await controlClient.status();
    sendToRenderer('event:status', status);
    sendToRenderer('event:dbConnected', db.isOpen);
  } catch (error) {
    log.debug({ err: errorMessage(error) }, 'status push failed');
  }
}

async function bootstrap(): Promise<void> {
  ensureAppDirs();

  // SQLite opens in microseconds, so unlike a network database there is no
  // reason to defer this or race it against a timeout.
  try {
    db.open();
  } catch (error) {
    log.error({ err: errorMessage(error) }, 'could not open the database');
  }

  const token = secrets.getToken();
  if (token) {
    github.setToken(token);
  }

  registerIpcHandlers();

  let startMinimized = false;
  try {
    const settings = getSettings();
    startMinimized = settings.startMinimized;
    controlClient.setPort(settings.controlPort);
  } catch (error) {
    log.warn({ err: errorMessage(error) }, 'could not read settings, using defaults');
  }

  createMainWindow(startMinimized || process.argv.includes('--hidden'));
  createTray();

  statusTimer = setInterval(() => {
    void pushStatus();
    void broadcastUnread();
  }, 20_000);
  statusTimer.unref?.();

  void pushStatus();
  await refreshTray();
}

app.whenReady().then(
  () => {
    void bootstrap();
  },
  (error: unknown) => {
    log.fatal({ err: errorMessage(error) }, 'app failed to start');
    app.exit(1);
  }
);

// The tray keeps the process alive on purpose; closing every window is a
// "minimise", not a "quit".
app.on('window-all-closed', () => {
  log.debug('all windows closed, staying in the tray');
});

app.on('activate', () => {
  showMainWindow();
});

app.on('before-quit', () => {
  markQuitting();
});

app.on('will-quit', () => {
  if (statusTimer) {
    clearInterval(statusTimer);
  }
  destroyTray();
  db.close();
});

process.on('unhandledRejection', (reason) => {
  log.error({ err: errorMessage(reason) }, 'unhandled rejection in main process');
});
