/**
 * Small, safe SQL helpers for repositories.
 *
 * SECURITY: column names come ONLY from the `columns` map written in code,
 * never from user input. Values are always passed as $n parameters.
 */

export type ColumnMap<T> = { readonly [K in keyof T]?: string };

/** Build "INSERT INTO t (cols) VALUES ($1..) RETURNING *" from a camelCase input object. */
export function buildInsert<T extends object>(table: string, columns: ColumnMap<T>, input: Partial<T>) {
  const cols: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(columns) as [keyof T & string, string][]) {
    if (input[key] !== undefined) {
      cols.push(col);
      values.push(input[key]);
    }
  }
  const placeholders = values.map((_, i) => `$${i + 1}`);
  return {
    text: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values,
  };
}

/** Build "UPDATE t SET a=$1.. WHERE id=$n RETURNING *". Returns null when nothing to update. */
export function buildUpdate<T extends object>(
  table: string,
  columns: ColumnMap<T>,
  input: Partial<T>,
  id: number,
  extraWhere = '',
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(columns) as [keyof T & string, string][]) {
    if (input[key] !== undefined) {
      values.push(input[key]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (sets.length === 0) return null;
  values.push(id);
  return {
    text: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${values.length} ${extraWhere} RETURNING *`,
    values,
  };
}

/** snake_case DB row -> camelCase API object (shallow). */
export function toCamel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

export const rowsToCamel = <T = Record<string, unknown>>(rows: Record<string, unknown>[]) => rows.map((r) => toCamel<T>(r));

/** Remove keys from an object (used to hide sensitive columns). */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

/** "contains" pattern for ILIKE with the user's % _ \ treated literally (no wildcard games). */
export const containsPattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
