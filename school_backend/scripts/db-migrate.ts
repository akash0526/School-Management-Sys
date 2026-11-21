/**
 * SCHEMA MIGRATIONS — upgrade an existing school database without losing data.
 *
 *   npm run db:migrate                 apply every pending migration
 *   npm run db:migrate -- --dry-run    show what would run, change nothing
 *   npm run db:migrate -- --to 0002    stop after 0002
 *   npm run db:migrate -- --backup     dump the database first (recommended)
 *   npm run db:migrate -- --status     show applied/pending and exit
 *   npm run db:migrate -- -v allow_duplicates=1    pass a psql-style variable
 *
 * Contract, in the order it is enforced:
 *   1. Every pending migration runs inside ONE transaction per file. It either
 *      fully applies or leaves no trace — a half-migrated schema is impossible.
 *   2. A migration that has already been applied is never re-run. Its checksum is
 *      compared instead: editing a shipped migration is an error, not a no-op, so
 *      two databases cannot silently diverge.
 *   3. Migrations run in name order, so the prefix is the ordering.
 *   4. The whole run takes an advisory lock: two deploys cannot migrate at once.
 *
 * Fresh installs already have the current shape (00–13 in install.sql), so they
 * record every migration as applied without executing it. `--force-run` overrides
 * that for auditing an idempotent migration against a real database.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from '../src/config/env.js';

const here = dirname(fileURLToPath(import.meta.url)); // school_backend/scripts
const repoRoot = resolve(here, '../..');
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? resolve(repoRoot, 'school_db/migrations');
const LOCK_KEY = 8_274_310_557; // arbitrary but stable: identifies "the SMS migration lock"

type Migration = { name: string; path: string; sql: string; checksum: string };

function parseArgs(argv: string[]) {
  const opts = { dryRun: false, status: false, to: '', backup: false, vars: [] as string[], forceRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--status') opts.status = true;
    else if (a === '--backup') opts.backup = true;
    else if (a === '--force-run') opts.forceRun = true;
    else if (a === '--to') opts.to = argv[++i] ?? '';
    else if (a === '-v' || a === '--set') {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value, e.g. -v allow_duplicates=1`);
      opts.vars.push(v);
    } else if (a.startsWith('--to=')) opts.to = a.slice(5);
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

const checksum = (text: string) => createHash('sha256').update(text).digest('hex');

function loadMigrations(): Migration[] {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const migrations = files.map((name) => {
    const path = resolve(MIGRATIONS_DIR, name);
    const sql = readFileSync(path, 'utf8');
    return { name, path, sql, checksum: checksum(sql) };
  });
  // A wrong prefix order is a silent data bug, so refuse anything that does not sort
  // the way a human expects: 0001, 0002, ... 0010.
  const prefixes = migrations.map((m) => m.name.split('_')[0]);
  const sorted = [...prefixes].sort();
  if (prefixes.join() !== sorted.join()) {
    throw new Error(`Migration names are not in sorted order — check zero-padding:\n  ${migrations.map((m) => m.name).join('\n  ')}`);
  }
  const dupes = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
  if (dupes.length) throw new Error(`Duplicate migration prefix: ${[...new Set(dupes)].join(', ')}`);
  return migrations;
}

/** psql-style variables are used by migrations for one-off decisions (-v allow_duplicates=1). */
function applyVars(sql: string, vars: string[]): string {
  let out = sql;
  for (const pair of vars) {
    const [key, ...rest] = pair.split('=');
    const value = rest.join('=');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Bad variable name: ${key}`);
    // strip the psql guard so the value is always available to current_setting()
    out = out.replace(new RegExp(`^\\\\set\\s+${key}\\b.*$`, 'gm'), '');
    out = out.replace(new RegExp(`current_setting\\('sms\\.${key}'\\s*,\\s*true\\)`, 'g'), `'${value.replace(/'/g, "''")}'`);
  }
  return out;
}

/** Remove psql meta-commands; this runner executes plain SQL through the pg driver. */
const stripMeta = (sql: string) => sql.replace(/^\\[a-z].*$/gm, '');

function backupDatabase(dbName: string, adminUrl: string) {
  const out = resolve(process.cwd(), `backup-${dbName}-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  try {
    const url = new URL(adminUrl);
    execFileSync(
      'pg_dump',
      ['--format=custom', `--dbname=${url.toString().replace(url.pathname, `/${dbName}`)}`, `--file=${out}`],
      { stdio: 'inherit', env: { ...process.env, PGPASSWORD: url.password } },
    );
    return out;
  } catch (err) {
    throw new Error(
      `Backup failed (${(err as Error).message}). No migration was attempted.\n` +
        'Install pg_dump, or re-run without --backup if you have your own backup.',
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const dbUrl = new URL(env.DATABASE_URL);
  const dbName = dbUrl.pathname.replace(/^\//, '') || 'school_sms';
  const migrations = loadMigrations();

  if (!migrations.length) {
    console.log('No migration files found.');
    return;
  }

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  let lockHeld = false;
  try {
    // 4. one migration run at a time, across processes and machines
    const lock = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    lockHeld = lock.rows[0]?.ok === true;
    if (!lockHeld) {
      throw new Error('Another migration is running (advisory lock is held). Wait for it to finish.');
    }

    // The ledger itself is a migration-managed object: create it if this database predates it.
    await client.query(readFileSync(resolve(repoRoot, 'school_db/sms/13_migrations.sql'), 'utf8'));

    const applied = new Map<string, { checksum: string; applied_at: Date }>(
      (await client.query('SELECT name, checksum, applied_at FROM schema_migrations')).rows.map(
        (r: { name: string; checksum: string; applied_at: Date }) => [r.name, { checksum: r.checksum, applied_at: r.applied_at }],
      ),
    );

    // 2. a shipped migration must never be edited
    for (const m of migrations) {
      const prior = applied.get(m.name);
      if (prior && prior.checksum !== m.checksum) {
        throw new Error(
          `Migration ${m.name} was already applied (${prior.applied_at.toISOString()}) but its contents have changed.\n` +
            'Editing an applied migration makes databases diverge. Add a NEW migration instead, or,\n' +
            'if the change is genuinely a no-op, run: npm run db:migrate -- --force-run',
        );
      }
    }

    // --force-run replays applied migrations too (that is how you audit that a migration is
    // genuinely idempotent). Applied ones are re-executed and their record updated.
    const inRange = (m: Migration) => !opts.to || m.name.split('_')[0] <= opts.to;
    const pending = migrations.filter((m) => (opts.forceRun || !applied.has(m.name)) && inRange(m));

    if (opts.status) {
      for (const m of migrations) {
        const a = applied.get(m.name);
        console.log(`  ${a ? '✔ applied' : '· pending'}  ${m.name}${a ? `  (${a.applied_at.toISOString().slice(0, 10)})` : ''}`);
      }
      console.log(`\nDatabase ${dbName}: ${applied.size} applied, ${migrations.length - applied.size} pending.`);
      return;
    }

    if (!pending.length) {
      console.log(`✔ ${dbName} is up to date (${migrations.length} migrations applied).`);
      return;
    }

    console.log(
      `Database ${dbName}: ${pending.length} ${opts.forceRun ? 'to re-run (--force-run)' : 'pending'} migration(s) of ${migrations.length}.`,
    );
    for (const m of pending) console.log(`  • ${m.name}`);

    if (opts.dryRun) {
      console.log('\n--dry-run: nothing was changed.');
      return;
    }

    if (opts.backup) {
      console.log('\n• Backing up before migrating (--backup)');
      const file = backupDatabase(dbName, env.DATABASE_URL);
      console.log(`  saved to ${file}`);
    }

    // A fresh install from install.sql already has today's shape, so replaying the
    // migrations there is harmless but pointless (and slow on a big table). Such a
    // database is identified by the CURRENT shape being present — never by "the ledger
    // is empty", because a legacy database also has an empty ledger. That mistake would
    // mark a live school's migrations as applied without ever running them.
    const isFreshInstall =
      applied.size === 0 &&
      (await client.query(
        `SELECT to_regclass('public.schema_migrations') IS NOT NULL
            AND to_regclass('public.uq_invoice_enrollment_period') IS NOT NULL AS fresh`,
      )).rows[0]?.fresh === true;

    for (const m of pending) {
      const started = Date.now();
      const body = stripMeta(applyVars(m.sql, opts.vars));

      // The migration and its ledger row commit together, so the ledger can never claim a
      // migration that was rolled back — nor forget one that was applied.
      await client.query('BEGIN');
      try {
        if (opts.forceRun || !isFreshInstall) {
          console.log(`\n• Applying ${m.name}`);
          await client.query(body);
        } else {
          console.log(`\n• Recording ${m.name} as applied (fresh install already has this shape)`);
        }
        await client.query(
          `INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)
           ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), duration_ms = EXCLUDED.duration_ms`,
          [m.name, m.checksum, Date.now() - started],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          `Migration ${m.name} failed and was rolled back — the database is unchanged:\n  ${(err as Error).message}\n${m.path}`,
        );
      }
      console.log(`  ✔ ${m.name} (${Date.now() - started} ms)`);
    }

    const stillPending = migrations.length - applied.size - pending.length;
    if (stillPending > 0) {
      console.log(
        `\n✔ ${dbName}: ${applied.size + pending.length} applied${opts.to ? ` (stopped at ${opts.to})` : ''}, ` +
          `${stillPending} still pending — run npm run db:migrate to finish.`,
      );
    } else {
      console.log(`\n✔ ${dbName} is up to date (${migrations.length} migrations applied).`);
    }
  } finally {
    if (lockHeld) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

main().catch((err: Error) => {
  console.error(`\n✘ ${err.message}`);
  process.exit(1);
});
