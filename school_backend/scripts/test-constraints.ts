/**
 * DATABASE CONSTRAINT TESTS — runner.
 *
 *   npm run db:test
 *   DB_TEST_URL=postgres://postgres@localhost:5432/postgres npm run db:test
 *
 * Creates a throwaway database, installs the real schema (school_db/sms/install.sql),
 * then runs school_db/tests/test_constraints.sql and reports EVERY assertion by name.
 *
 * How pass/fail works: the SQL file asserts by failing. Part 1 must succeed; every
 * statement in Part 2 must be rejected by the schema. This runner counts them and
 * exits non-zero if any mistake was accepted — and prints exactly which rule is missing.
 *
 * The admin/maintenance connection must be allowed to CREATE DATABASE. The test
 * database is always dropped, even on failure.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url)); // school_backend/scripts
const repoRoot = resolve(here, '../..');
const SCHEMA = resolve(repoRoot, 'school_db/sms/install.sql');
const TEST = resolve(repoRoot, 'school_db/tests/test_constraints.sql');
const DB_NAME = 'school_sms_constraints_test';

/** The maintenance URL: an existing database we can connect to in order to create ours. */
const ADMIN_URL =
  process.env.DB_TEST_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/postgres';

/**
 * psql's `\ir` includes the relative path of the *including* file. Inline them so the
 * schema can be executed as plain SQL by any client (this mirrors scripts/db-reset.sh).
 */
function loadSchema(): string {
  const install = readFileSync(SCHEMA, 'utf8');
  return (
    install
      // psql's \ir -> inline the file (the schema must also run through any plain SQL client)
      .replace(/^\\ir\s+(.+)$/gm, (_, name: string) => readFileSync(resolve(dirname(SCHEMA), name.trim()), 'utf8'))
      // psql meta-commands (\set, \echo) are not SQL
      .replace(/^\\(?!ir\s).*$/gm, '')
  );
}

/** Remove psql meta-commands (\set, \echo) from a block of the test file. */
const stripMeta = (sql: string) => sql.replace(/^\\[a-z].*$/gm, '');

/** Split the test file into its phases and individual assertions. */
function parseTestFile(sql: string) {
  const setupStart = sql.indexOf('--- PART 1: setup'.replace('--- ', '')); // marker comment
  const part1b = sql.indexOf('PART 1b');
  const part2Marker = sql.indexOf('PART 2 — MUST FAIL');
  if (part2Marker < 0) throw new Error('test_constraints.sql: PART 2 marker not found');

  const setupBlock = sql.slice(sql.indexOf('-- PART 1') >= 0 ? sql.indexOf('-- PART 1') : 0, part2Marker);
  const part2Block = sql.slice(part2Marker);

  // Setup: everything between BEGIN; and COMMIT; in the setup section
  const begin = setupBlock.indexOf('BEGIN;');
  const commit = setupBlock.indexOf('COMMIT;');
  const setupSql = setupBlock.slice(begin, commit + 'COMMIT;'.length);

  // State checks: the DO blocks + the UPDATE that sit after the setup COMMIT
  const stateSql = setupBlock.slice(commit + 'COMMIT;'.length);

  // Assertions: one per line, in order, each carrying its "-- expect:" label
  const assertions = part2Block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(INSERT|UPDATE|DELETE)\b/.test(line))
    .map((line, i) => {
      const labelled = /--\s*expect:\s*(.+)$/.exec(line);
      const statement = line.replace(/--.*$/, '').trim().replace(/;$/, '');
      return { n: i + 1, statement, label: labelled ? labelled[1].trim() : statement.slice(0, 80) };
    });
  if (!assertions.length) throw new Error('test_constraints.sql: no assertions found in PART 2');
  return { setupSql, stateSql, assertions };
}

/** Run the state checks statement-by-statement (each starts with BEGIN; and ends with COMMIT;). */
async function runStateChecks(client: pg.Client) {
  const stateText = parseTestFile(readFileSync(TEST, 'utf8')).stateSql;
  // Each check is a self-contained BEGIN ... COMMIT block.
  const blocks = stateText.split(/^(?=BEGIN;)/m).map((b) => b.trim()).filter((b) => b.startsWith('BEGIN;'));
  for (const [i, block] of blocks.entries()) {
    try {
      await client.query(stripMeta(block));
    } catch (err) {
      throw new Error(`trigger-state checks failed: ${(err as Error).message}`);
    }
  }
  // report the number of DO-block checks, not the number of transactions wrapping them
  return blocks.reduce((n, b) => n + (b.match(/\bDO \$\$/g)?.length ?? 0), 0);
}

async function run() {
  const { setupSql, assertions } = parseTestFile(readFileSync(TEST, 'utf8'));

  // 1. connect to the maintenance database and (re)create the throwaway one
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  console.log(`• Recreating throwaway database ${DB_NAME}`);
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB_NAME}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  let failed = false;
  try {
    console.log('• Installing schema (school_db/sms/install.sql)');
    await client.query(loadSchema());

    console.log('• Part 1: setup + trigger state');
    await client.query(stripMeta(setupSql));
    const stateChecks = await runStateChecks(client);
    console.log(`  ✔ setup applied, ${stateChecks} trigger-state checks passed`);

    console.log(`• Part 2: ${assertions.length} must-fail assertions`);
    const verbose = process.argv.includes('--verbose');
    const allowed: typeof assertions = [];
    for (const a of assertions) {
      try {
        await client.query(a.statement);
        allowed.push(a); // it succeeded => the rule is NOT enforced
        console.log(`  ✘ ALLOWED   ${a.label}`);
      } catch (err) {
        // The reason matters: a statement blocked by a typo, a missing fixture or the
        // wrong constraint is not evidence that the rule works. --verbose shows it.
        const reason = (err as Error).message.split('\n')[0];
        console.log(`  ✔ blocked   ${a.label}${verbose ? `\n                ↳ ${reason}` : ''}`);
      }
    }
    const blocked = assertions.length - allowed.length;

    console.log('');
    if (allowed.length) {
      failed = true;
      console.log(`✘ ${blocked}/${assertions.length} rules enforced — ${allowed.length} NOT enforced:`);
      for (const a of allowed) console.log(`   - ${a.label}\n     ${a.statement}`);
    } else {
      console.log(`✔ all ${assertions.length} constraint assertions hold (${stateChecks} state checks + ${blocked} rejections)`);
    }
  } catch (err) {
    failed = true;
    console.error(`✘ ${(err as Error).message}`);
  } finally {
    await client.end();
    const cleanup = new pg.Client({ connectionString: ADMIN_URL });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).catch(() => undefined);
    await cleanup.end();
  }
  process.exit(failed ? 1 : 0);
}

void run();
