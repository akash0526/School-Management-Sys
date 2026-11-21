/**
 * Revoke or rotate an API client's key (e.g. after a leak).
 *
 *   npm run manage-api-key -- --name public-website --revoke
 *   npm run manage-api-key -- --name public-website --rotate     # prints the new key ONCE
 */
import { parseArgs } from 'node:util';
import { loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/shared/db/database.js';
import { createEventBus } from '../src/shared/events/eventBus.js';
import { createLogger } from '../src/shared/logger.js';
import { PublicService } from '../src/modules/public/business/public.service.js';
import { PgPublicRepository } from '../src/modules/public/data/public.repository.js';

const { values } = parseArgs({ options: { name: { type: 'string' }, revoke: { type: 'boolean' }, rotate: { type: 'boolean' } } });
if (!values.name || values.revoke === values.rotate) {
  console.error('Usage: npm run manage-api-key -- --name <client> (--revoke | --rotate)');
  process.exit(1);
}
const env = loadEnv();
const logger = createLogger('error', false);
const db = createDatabase({ url: env.DATABASE_URL, max: 1, ssl: env.DB_SSL, logger });
try {
  const service = new PublicService(new PgPublicRepository(db), db, createEventBus(logger));
  if (values.revoke) {
    await service.revokeClient(values.name);
    console.log(`✔ API client '${values.name}' revoked — its key no longer works.`);
  } else {
    const { apiKey } = await service.rotateClientKey(values.name);
    console.log(`✔ New key for '${values.name}' (old key is now invalid):\n\n  X-API-Key: ${apiKey}\n`);
  }
} catch (err) {
  console.error(`✘ ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
