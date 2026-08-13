import { controlServer } from '../core/control-server';
import { engine } from '../core/engine';
import { logger } from '../core/logger';
import { getSettings } from '../core/settings-service';
import { errorMessage } from '../shared/errors';

/**
 * Headless background service.
 *
 * This is what systemd runs. It owns the webhook receiver, the poller and the
 * desktop notifications, and keeps working with the Electron window closed —
 * which is the whole point of splitting it out.
 */

process.env.APP_COMPONENT = 'daemon';
const log = logger.child({ component: 'daemon' });

let shuttingDown = false;

async function main(): Promise<void> {
  log.info({ node: process.version, pid: process.pid }, 'github-notifier daemon starting');

  await engine.start();

  const settings = getSettings();
  await controlServer.start({ port: settings.controlPort, engine });

  log.info(
    { controlPort: settings.controlPort, webhookPort: settings.webhookPort },
    'daemon ready'
  );
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log.info({ signal }, 'shutting down');

  // systemd's default TimeoutStopSec is 90s; give up well before that so a
  // hung Mongo socket cannot turn a restart into a SIGKILL.
  const timeout = setTimeout(() => {
    log.warn('graceful shutdown timed out, exiting anyway');
    process.exit(1);
  }, 8000);
  timeout.unref();

  try {
    await controlServer.stop();
    await engine.stop();
  } catch (error) {
    log.error({ err: errorMessage(error) }, 'error during shutdown');
  }
  clearTimeout(timeout);
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on('unhandledRejection', (reason) => {
  log.error({ err: errorMessage(reason) }, 'unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  log.fatal({ err: errorMessage(error) }, 'uncaught exception, restarting');
  void shutdown('uncaughtException');
});

main().catch((error: unknown) => {
  log.fatal({ err: errorMessage(error) }, 'daemon failed to start');
  process.exit(1);
});
