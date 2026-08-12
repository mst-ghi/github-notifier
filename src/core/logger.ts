import { createWriteStream } from 'node:fs';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { LOG_FILE, ensureAppDirs } from './paths';

export type { Logger };

const isDev = process.env.NODE_ENV === 'development';
const level = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

/**
 * In development we pretty-print to stdout. In production we write JSON lines to
 * both stdout (so `journalctl -u github-notifier` is useful) and a rotating-ish
 * file the UI can point users at.
 */
function buildLogger(): Logger {
  const options: LoggerOptions = {
    level,
    base: { pid: process.pid, component: process.env.APP_COMPONENT ?? 'app' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'token',
        'accessToken',
        'secret',
        'webhookSecret',
        '*.token',
        '*.secret',
        'headers.authorization',
        'headers["x-hub-signature-256"]',
      ],
      censor: '[redacted]',
    },
  };

  if (isDev) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }

  try {
    ensureAppDirs();
    const fileStream = createWriteStream(LOG_FILE, { flags: 'a' });
    return pino(
      options,
      pino.multistream([
        { level: level as pino.Level, stream: process.stdout },
        { level: level as pino.Level, stream: fileStream },
      ])
    );
  } catch {
    // A read-only home directory must not stop the app from starting.
    return pino(options);
  }
}

export const logger: Logger = buildLogger();

/** Child logger tagged with a subsystem name. */
export function childLogger(component: string): Logger {
  return logger.child({ component });
}
