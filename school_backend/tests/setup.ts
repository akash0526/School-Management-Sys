/**
 * Test environment defaults.
 *
 * `npm test` must work on a fresh clone with no .env file. Without this, importing
 * the app throws "Insecure configuration" before a single test runs, so contributors
 * learn to ignore a red suite.
 *
 * These values apply ONLY inside vitest, only when nothing is already set, and they
 * are obviously non-production. Anything already in the environment wins, so CI and
 * local runs against a real database behave exactly as before.
 */
import { randomBytes } from 'node:crypto';

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  // localhost, so the DB_SSL / production checks never apply
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/school_sms',
  // generated per run: passes the "placeholder" and "little variety" guards without
  // ever looking like a real credential that someone might copy
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
  LOG_LEVEL: 'error',
  // the per-IP limiter is for real clients; a test run fires hundreds of requests
  API_RATE_LIMIT_PER_MIN: '100000',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
