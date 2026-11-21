import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './database.js';

/**
 * The code and the database must be the same version.
 *
 * After an upgrade the API is new but the schema may still be old: a query then fails
 * at runtime, in front of a parent at the fee counter, instead of at deploy time. This
 * check compares the migration files shipped WITH THE CODE against the ledger in the
 * database, so a forgotten `npm run db:migrate` is reported immediately.
 *
 * It never blocks startup: a version mismatch must not take the school offline, and a
 * read-only replica cannot write anyway. The operator sees a loud warning instead.
 *
 * Returns the pending migration names (empty when the schema is current).
 */
export function migrationFiles(): string[] {
  // <repo>/school_db/migrations — same location scripts/db-migrate.ts uses
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = process.env.MIGRATIONS_DIR ?? resolve(here, '../../../../school_db/migrations');
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return []; // no migration directory (e.g. a packaged build): nothing to compare
  }
}

export async function pendingMigrations(db: Database): Promise<string[]> {
  const files = migrationFiles();
  if (!files.length) return [];
  try {
    const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    return files.filter((f) => !applied.has(f));
  } catch (err) {
    // A database that predates the ledger has none of the migrations recorded, so
    // every one of them is pending.
    if ((err as { code?: string }).code === '42P01') return files; // undefined_table
    throw err;
  }
}
