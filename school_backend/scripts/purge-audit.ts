/**
 * AUDIT RETENTION — trim `audit_logs` to the school's retention window.
 *
 *   npm run db:retention                  report what is eligible, delete nothing
 *   npm run db:retention -- --apply       actually delete
 *   npm run db:retention -- --days 365    override the configured window
 *
 * Why a script and not a database job: the window lives in
 * `settings.audit_log_retention_days`, so a school can change it without a deploy, and
 * the purge is an explicit, logged action rather than something that fires from inside a
 * request. Schedule it (cron, a systemd timer, or whatever the host already uses).
 *
 * DRY RUN IS THE DEFAULT, deliberately. This is the one operation in the codebase that
 * destroys audit history; `purge_audit_logs()` will happily delete if asked, so the thing
 * that runs unattended should be the read-only one. A cron entry needs `--apply` to make
 * it do anything at all — if someone schedules this while debugging, the worst outcome is
 * a log line saying "would have purged N rows". Flip the flag once you have seen that line.
 *
 * Example crontab — 03:15 on the first of each month:
 *   15 3 1 * *  cd /srv/school/school_backend && npm run db:retention -- --apply >> /var/log/school-retention.log 2>&1
 *
 * Exits non-zero if the purge fails, so a scheduler can alert on it.
 */
import pg from 'pg';
import { loadEnv } from '../src/config/env.js';

type Options = { apply: boolean; days: number | null; help: boolean };

function parseArgs(argv: string[]): Options {
  const opts: Options = { apply: false, days: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--dry-run') opts.apply = false;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--days') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v)) throw new Error('--days needs a whole number, e.g. --days 365');
      opts.days = v;
    } else if (a.startsWith('--days=')) {
      const v = Number(a.slice(7));
      if (!Number.isInteger(v)) throw new Error('--days needs a whole number, e.g. --days 365');
      opts.days = v;
    } else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

const USAGE = `
Trim audit_logs to the retention window.

  npm run db:retention                 dry run — report eligible rows, delete nothing
  npm run db:retention -- --apply      delete rows past the window
  npm run db:retention -- --days 365   use this window instead of the configured one

The window comes from settings.audit_log_retention_days (0 disables purging).
Nothing under 30 days is accepted, and security_events is never touched.
`.trim();

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const env = loadEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    const configured = await client.query<{ days: string | null }>(
      `SELECT (value #>> '{}') AS days FROM settings WHERE key = 'audit_log_retention_days'`,
    );
    const windowDays = opts.days ?? (configured.rows[0]?.days == null ? null : Number(configured.rows[0].days));

    if (windowDays == null || windowDays <= 0) {
      // Not an error: "keep everything" is a valid choice, and a scheduler must not
      // start alerting because a school decided to keep its history.
      console.log('• audit retention is disabled (audit_log_retention_days is unset or 0) — nothing to do');
      return;
    }
    if (windowDays < 30) {
      throw new Error(
        `refusing a ${windowDays}-day window: the minimum is 30 days, so a mistyped value cannot shred a term of history`,
      );
    }

    const before = await client.query<{ n: number; oldest: string | null }>(
      `SELECT count(*)::int AS n, min(created_at)::text AS oldest FROM audit_logs`,
    );
    console.log(`• audit_logs: ${before.rows[0].n} row(s), oldest ${before.rows[0].oldest ?? '—'}`);

    // purge_audit_logs(INT, BOOLEAN) is the one place that knows how to lift the append-only
    // guard. The window is always passed explicitly — otherwise a dry run of --days 365
    // would count against the configured 730 and under-report.
    const result = await client.query<{ n: string }>(
      `SELECT purge_audit_logs($1, $2) AS n`,
      [windowDays, !opts.apply],
    );
    const affected = Number(result.rows[0].n);

    if (opts.apply) {
      const after = await client.query<{ n: number; oldest: string | null }>(
        `SELECT count(*)::int AS n, min(created_at)::text AS oldest FROM audit_logs`,
      );
      console.log(
        `✔ purged ${affected} row(s) older than ${windowDays} days — ${after.rows[0].n} remaining, ` +
          `oldest ${after.rows[0].oldest ?? '—'}`,
      );
    } else if (affected > 0) {
      console.log(`• ${affected} row(s) older than ${windowDays} days are eligible — nothing deleted (dry run)`);
      console.log('  re-run with --apply to delete them');
    } else {
      console.log(`• nothing older than ${windowDays} days — nothing to purge`);
    }
  } finally {
    await client.end();
  }
}

run().catch((err: unknown) => {
  console.error(`\n✘ ${(err as Error).message}`);
  process.exitCode = 1;
});
