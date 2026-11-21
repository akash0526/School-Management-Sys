/**
 * Create (or reset) the first super-admin account.
 *
 *   npm run create-admin -- --username admin --password 'a-long-strong-password' [--email admin@school.edu.np]
 *
 * Safe to re-run: an existing username gets its password reset and super_admin role ensured.
 */
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';
import { loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/shared/db/database.js';
import { createLogger } from '../src/shared/logger.js';
import { passwordProblems } from '../src/modules/auth/business/passwordPolicy.js';

const { values } = parseArgs({
  options: { username: { type: 'string' }, password: { type: 'string' }, email: { type: 'string' } },
});
const username = values.username?.trim();
const password = values.password ?? process.env.ADMIN_PASSWORD;
if (!username || !password) {
  console.error("Usage: npm run create-admin -- --username <name> --password '<password>' [--email <email>]");
  process.exit(1);
}
const problems = [...passwordProblems(password, { username }), ...(password.length < 12 ? ['must be at least 12 characters for an admin'] : [])];
if (problems.length) {
  console.error(`Password ${problems.join(', ')}.`);
  process.exit(1);
}

const env = loadEnv();
const db = createDatabase({ url: env.DATABASE_URL, max: 1, ssl: env.DB_SSL, logger: createLogger('error', false) });
try {
  const hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const userId = await db.transaction(null, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO users (username, email, password_hash, must_change_password, is_active)
       VALUES ($1, $2, $3, FALSE, TRUE)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE, deleted_at = NULL
       RETURNING id`,
      [username, values.email ?? null, hash],
    );
    const id = rows[0].id as number;
    const role = await tx.query(`SELECT id FROM roles WHERE name = 'super_admin'`);
    if (!role.rowCount) throw new Error("Role 'super_admin' not found — did you run 99_seed.sql?");
    await tx.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, role.rows[0].id]);
    return id;
  });
  console.log(`✔ Super admin '${username}' ready (user id ${userId}).`);
} finally {
  await db.close();
}
