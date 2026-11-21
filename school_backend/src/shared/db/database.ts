import pg from 'pg';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Type parsing
//  - DATE stays a 'YYYY-MM-DD' string (avoids timezone shifting — important for BS/AD conversion)
//  - BIGINT / NUMERIC become JS numbers (ids and NUMERIC(12,2) money fit safely in a double)
// ---------------------------------------------------------------------------
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric

/** Anything that can run a query: the pool, or a client inside a transaction. */
export interface Queryable {
  query<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

/**
 * Opaque transaction handle passed from the business layer to the data layer.
 * Business code never runs SQL with it — it only hands it to repositories.
 */
export type Tx = Queryable;

/** Business layer depends on this small interface, not on pg. */
export interface TransactionRunner {
  /**
   * Runs `fn` in a transaction. `actorUserId` is written to the `app.user_id`
   * setting so the database audit trigger records who made each change.
   */
  transaction<T>(actorUserId: number | null, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface Database extends Queryable, TransactionRunner {
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(opts: { url: string; max: number; logger: Logger; ssl?: boolean }): Database {
  const pool = new pg.Pool({
    connectionString: opts.url,
    max: opts.max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000, // no runaway queries
    // TLS with certificate verification when the DB is on another machine (DB_SSL=true)
    ...(opts.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  pool.on('error', (err) => opts.logger.error({ err }, 'Unexpected PostgreSQL pool error'));

  return {
    query: (text, params) => pool.query(text, params as any[]),

    async transaction(actorUserId, fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (actorUserId !== null) {
          await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(actorUserId)]);
        }
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    async ping() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },

    close: () => pool.end(),
  };
}
