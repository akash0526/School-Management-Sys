/**
 * Create an API key for a machine client (normally the public website server).
 *
 *   npm run create-api-key -- --name public-website \
 *       --scopes school.read,notices.read,events.read,staff.read,inquiries.create,results.lookup \
 *       [--ips 203.0.113.10,203.0.113.11]
 *
 * The key is printed ONCE. Only its SHA-256 hash is stored in api_clients.
 */
import { parseArgs } from 'node:util';
import { loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/shared/db/database.js';
import { createEventBus } from '../src/shared/events/eventBus.js';
import { createLogger } from '../src/shared/logger.js';
import { PUBLIC_SCOPES } from '../src/modules/public/business/public.ports.js';
import { PublicService } from '../src/modules/public/business/public.service.js';
import { PgPublicRepository } from '../src/modules/public/data/public.repository.js';

const { values } = parseArgs({ options: { name: { type: 'string' }, scopes: { type: 'string' }, ips: { type: 'string' } } });
const split = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
if (!values.name || !values.scopes) {
  console.error(`Usage: npm run create-api-key -- --name <client> --scopes <comma list> [--ips <comma list>]\nScopes: ${PUBLIC_SCOPES.join(', ')}`);
  process.exit(1);
}

const env = loadEnv();
const logger = createLogger('error', false);
const db = createDatabase({ url: env.DATABASE_URL, max: 1, ssl: env.DB_SSL, logger });
try {
  const service = new PublicService(new PgPublicRepository(db), db, createEventBus(logger));
  const { id, apiKey } = await service.createClient({ name: values.name, scopes: split(values.scopes), allowedIps: split(values.ips) });
  console.log(`✔ API client '${values.name}' created (id ${id}).`);
  console.log(`\n  X-API-Key: ${apiKey}\n`);
  console.log('Store this in the WEBSITE server config now — it cannot be shown again.');
} finally {
  await db.close();
}
