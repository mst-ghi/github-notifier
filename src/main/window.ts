import { join } from 'node:path';
import { BrowserWindow, app, shell } from 'electron';
import { childLogger } from '../core/logger';
import type { IpcEventChannel, IpcEventPayload } from '../shared/types';

const log = childLogger('window');

const DEV_SERVER_URL = 'http://localhost:5173';
const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
/** Set on `app.quit()` so the close handler stops hiding to the tray. */
let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

export function isQuitting(): boolean {
  return quitting;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(startHidden: boolean): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    // Custom decorations: no OS frame, and a transparent surface so the
    // renderer can draw its own rounded corners. `backgroundColor` must stay
    // fully transparent or it paints over them.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    maximizable: true,
    hasShadow: true,
    title: 'GitHub Notifier',
    icon: join(app.getAppPath(), 'build', 'icons', '512x512.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => {
    if (!startHidden) {
      window.show();
    }
  });

  // Closing the window must not stop notifications, so it hides instead. The
  // daemon keeps running either way; this only affects the GUI.
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  // The custom titlebar draws its own maximise/restore icon, so it has to be
  // told when the state changes — including changes it did not cause, such as
  // a double-click on the drag region or a window-manager keyboard shortcut.
  const pushMaximizeState = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send('event:maximizeChanged', window.isMaximized());
    }
  };
  window.on('maximize', pushMaximizeState);
  window.on('unmaximize', pushMaximizeState);
  window.webContents.on('did-finish-load', pushMaximizeState);

  // External links open in the real browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    void window.loadURL(DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow = window;
  log.info({ dev: isDev, startHidden }, 'main window created');
  return window;
}

/** Shows and focuses the window, recreating it if it was destroyed. */
export function showMainWindow(): BrowserWindow {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow(false);
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
  return window;
}

export function hideMainWindow(): void {
  mainWindow?.hide();
}

/** Type-safe push to the renderer. No-op when the window does not exist. */
export function sendToRenderer<C extends IpcEventChannel>(
  channel: C,
  payload: IpcEventPayload<C>
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}
