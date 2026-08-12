import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import {
  KEYRING_ACCOUNT_TOKEN,
  KEYRING_ACCOUNT_WEBHOOK_SECRET,
  KEYRING_SERVICE,
} from '../shared/constants';
import { errorMessage } from '../shared/errors';
import { childLogger } from './logger';
import { CONFIG_DIR, SECRET_FALLBACK_FILE, ensureDir } from './paths';

const log = childLogger('secrets');

/* ------------------------------------------------------------------ */
/* Keyring backend (libsecret via @napi-rs/keyring)                    */
/* ------------------------------------------------------------------ */

/** Minimal surface of `@napi-rs/keyring` we depend on. */
interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

let keyringModule: KeyringModule | null = null;
let keyringProbed = false;

function loadKeyring(): KeyringModule | null {
  if (keyringProbed) {
    return keyringModule;
  }
  keyringProbed = true;
  try {
    // Loaded lazily: on a machine with no secret service the native module
    // still imports fine but every call throws, so we also probe at call time.
    // biome-ignore lint/suspicious/noExplicitAny: require() has no static type here
    const mod = require('@napi-rs/keyring') as any;
    if (mod && typeof mod.Entry === 'function') {
      keyringModule = mod as KeyringModule;
    }
  } catch (error) {
    log.warn({ err: errorMessage(error) }, 'keyring module unavailable, using encrypted file');
    keyringModule = null;
  }
  return keyringModule;
}

/* ------------------------------------------------------------------ */
/* Encrypted-file fallback                                             */
/* ------------------------------------------------------------------ */

interface EncryptedRecord {
  iv: string;
  tag: string;
  data: string;
}

type FallbackStore = Record<string, EncryptedRecord>;

/**
 * Key material is derived from stable machine + user facts. This protects the
 * file from casual copying to another machine; it is deliberately weaker than
 * the keyring and only used when no secret service exists.
 */
function fallbackKey(): Buffer {
  const machineId = readMachineId();
  const material = `${machineId}:${userInfo().username}:${hostname()}`;
  return scryptSync(material, 'github-notifier-secret-v1', 32);
}

function readMachineId(): string {
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      if (existsSync(file)) {
        return readFileSync(file, 'utf8').trim();
      }
    } catch {
      // fall through to the next candidate
    }
  }
  return 'no-machine-id';
}

function readFallbackStore(): FallbackStore {
  if (!existsSync(SECRET_FALLBACK_FILE)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(SECRET_FALLBACK_FILE, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as FallbackStore) : {};
  } catch (error) {
    log.error({ err: errorMessage(error) }, 'secret store is corrupt, starting empty');
    return {};
  }
}

function writeFallbackStore(store: FallbackStore): void {
  ensureDir(CONFIG_DIR);
  writeFileSync(SECRET_FALLBACK_FILE, JSON.stringify(store), { mode: 0o600 });
  chmodSync(SECRET_FALLBACK_FILE, 0o600);
}

function fallbackSet(account: string, value: string): void {
  const key = fallbackKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const store = readFallbackStore();
  store[account] = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  writeFallbackStore(store);
}

function fallbackGet(account: string): string | null {
  const record = readFallbackStore()[account];
  if (!record) {
    return null;
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      fallbackKey(),
      Buffer.from(record.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    log.error({ account, err: errorMessage(error) }, 'failed to decrypt secret');
    return null;
  }
}

function fallbackDelete(account: string): boolean {
  const store = readFallbackStore();
  if (!(account in store)) {
    return false;
  }
  delete store[account];
  writeFallbackStore(store);
  return true;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export type SecretBackend = 'keyring' | 'file';

let activeBackend: SecretBackend | null = null;

export function secretBackend(): SecretBackend {
  return activeBackend ?? (loadKeyring() ? 'keyring' : 'file');
}

function setSecret(account: string, value: string): void {
  const mod = loadKeyring();
  if (mod) {
    try {
      new mod.Entry(KEYRING_SERVICE, account).setPassword(value);
      activeBackend = 'keyring';
      return;
    } catch (error) {
      log.warn({ account, err: errorMessage(error) }, 'keyring write failed, falling back to file');
    }
  }
  fallbackSet(account, value);
  activeBackend = 'file';
}

function getSecret(account: string): string | null {
  const mod = loadKeyring();
  if (mod) {
    try {
      const value = new mod.Entry(KEYRING_SERVICE, account).getPassword();
      if (value) {
        activeBackend = 'keyring';
        return value;
      }
    } catch {
      // Not found, or no secret service running. Try the file store next.
    }
  }
  const fromFile = fallbackGet(account);
  if (fromFile !== null) {
    activeBackend = 'file';
  }
  return fromFile;
}

function deleteSecret(account: string): boolean {
  let removed = false;
  const mod = loadKeyring();
  if (mod) {
    try {
      removed = new mod.Entry(KEYRING_SERVICE, account).deletePassword();
    } catch {
      // ignore: nothing stored in the keyring
    }
  }
  return fallbackDelete(account) || removed;
}

export const secrets = {
  getToken(): string | null {
    return process.env.GITHUB_TOKEN ?? getSecret(KEYRING_ACCOUNT_TOKEN);
  },
  setToken(token: string): void {
    setSecret(KEYRING_ACCOUNT_TOKEN, token.trim());
  },
  clearToken(): boolean {
    return deleteSecret(KEYRING_ACCOUNT_TOKEN);
  },
  hasToken(): boolean {
    return this.getToken() !== null;
  },

  getWebhookSecret(): string | null {
    return process.env.GITHUB_WEBHOOK_SECRET ?? getSecret(KEYRING_ACCOUNT_WEBHOOK_SECRET);
  },
  setWebhookSecret(secret: string): void {
    setSecret(KEYRING_ACCOUNT_WEBHOOK_SECRET, secret.trim());
  },
  generateWebhookSecret(): string {
    const secret = randomBytes(32).toString('hex');
    setSecret(KEYRING_ACCOUNT_WEBHOOK_SECRET, secret);
    return secret;
  },
  hasWebhookSecret(): boolean {
    return this.getWebhookSecret() !== null;
  },
} as const;
