import { loadEnv } from './config/env.js';
import { buildContainer } from './container.js';
import { createApp } from './app.js';
import { createLogger } from './shared/logger.js';
import { pendingMigrations } from './shared/db/migrations.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const container = buildContainer(env, logger);
const app = createApp(container);

// A schema that lags the code fails later, at a request, in front of a user — and it must be
// visible even when LOG_LEVEL is 'error', because the operator configured log verbosity for
// routine noise, not to hide a broken deployment. So this goes to stderr as well as the log.
void pendingMigrations(container.core.db)
  .then((pending) => {
    if (!pending.length) return;
    const msg =
      `DATABASE IS ${pending.length} MIGRATION(S) BEHIND THIS CODE — run: npm run db:migrate ` +
      `(missing: ${pending.join(', ')})`;
    logger.warn({ pending }, msg);
    process.stderr.write(`\n!! ${msg}\n\n`);
  })
  .catch((err) => logger.warn({ err }, 'Could not check for pending schema migrations'));

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(`School SMS API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
});
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down…');
  const force = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
  server.close(async () => {
    await container.core.db.close().catch(() => undefined);
    clearTimeout(force);
    logger.info('Bye');
    process.exit(0);
  });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));
