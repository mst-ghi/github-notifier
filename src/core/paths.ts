import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR_NAME } from '../shared/constants';

/** Node-only. Never import this from the renderer. */

function xdg(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  return value?.startsWith('/') ? value : join(homedir(), fallback);
}

export const CONFIG_DIR: string = join(xdg('XDG_CONFIG_HOME', '.config'), CONFIG_DIR_NAME);
export const STATE_DIR: string = join(xdg('XDG_STATE_HOME', '.local/state'), CONFIG_DIR_NAME);
export const DATA_DIR: string = join(xdg('XDG_DATA_HOME', '.local/share'), CONFIG_DIR_NAME);

/** Written by the daemon, read by the Electron app to authenticate to the control API. */
export const CONTROL_TOKEN_FILE: string = join(CONFIG_DIR, 'control.token');
/** Fallback secret store used when no libsecret keyring is available. */
export const SECRET_FALLBACK_FILE: string = join(CONFIG_DIR, 'secrets.enc.json');
export const LOG_FILE: string = join(STATE_DIR, 'daemon.log');
export const ICON_DIR: string = join(DATA_DIR, 'icons');

export function ensureDir(dir: string): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function ensureAppDirs(): void {
  ensureDir(CONFIG_DIR);
  ensureDir(STATE_DIR);
  ensureDir(DATA_DIR);
}
