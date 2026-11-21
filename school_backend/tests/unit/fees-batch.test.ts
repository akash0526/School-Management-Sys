import { describe, expect, it, vi } from 'vitest';
import { PgFeesRepository } from '../../src/modules/fees/data/fees.repository.js';

/**
 * The batch invoice writer replaced a per-student loop, so its contract is worth pinning
 * without a database: what it sends, in what order, and what it does when the conflict
 * skip fires. A fake `Queryable` records the statements and hands back canned rows.
 */
function fakeDb(responses: Array<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return responses[i++] ?? { rows: [] };
    }),
  };
  return { db, calls };
}

const repo = (db: unknown) => new PgFeesRepository(db as never);

const header = {
  billingPeriod: '2083-Baisakh',
  issueDate: '2026-04-14',
  dueDate: null,
  createdBy: 7,
  invoiceNoFor: (seq: number) => `INV-2083-${String(seq).padStart(6, '0')}`,
};

describe('createInvoicesBatch', () => {
  it('does nothing at all when the batch is empty', async () => {
    const { db, calls } = fakeDb([]);
    const out = await repo(db).createInvoicesBatch([], header, db as never);
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('reserves exactly one sequence value per invoice and numbers them from the block', async () => {
    const { db, calls } = fakeDb([
      { rows: [{ n: '11' }, { n: '12' }] }, // nextval block
      { rows: [{ id: 5, enrollment_id: 100 }, { id: 6, enrollment_id: 101 }] }, // insert returning
      { rows: [] }, // items
      { rows: [{ id: 5, enrollment_id: 100, total_amount: '2700.00' }, { id: 6, enrollment_id: 101, total_amount: '3000.00' }] }, // totals
    ]);
    await repo(db).createInvoicesBatch(
      [
        { enrollmentId: 100, studentId: 1, items: [{ feeTypeId: 1, description: 'Tuition', amount: 3000, discount: 300 }] },
        { enrollmentId: 101, studentId: 2, items: [{ feeTypeId: 1, description: 'Tuition', amount: 3000, discount: 0 }] },
      ],
      header,
      db as never,
    );

    expect(calls[0].sql).toContain('nextval');
    expect(calls[0].params).toEqual([2]);

    const invoiceRows = JSON.parse(calls[1].params[0] as string);
    expect(invoiceRows.map((r: { invoice_no: string }) => r.invoice_no)).toEqual(['INV-2083-000011', 'INV-2083-000012']);
    // billing period / issue date / due date / author travel as scalars, not per row
    expect(calls[1].params.slice(1)).toEqual(['2083-Baisakh', '2026-04-14', null, 7]);
  });

  it('skips enrollments another request billed, without writing their items or a ledger charge', async () => {
    const { db, calls } = fakeDb([
      { rows: [{ n: '20' }, { n: '21' }] },
      { rows: [{ id: 9, enrollment_id: 100 }] }, // only 100 survived the conflict skip
      { rows: [] }, // items
      { rows: [{ id: 9, enrollment_id: 100, total_amount: '2700.00' }] },
    ]);
    const out = await repo(db).createInvoicesBatch(
      [
        { enrollmentId: 100, studentId: 1, items: [{ feeTypeId: 1, description: 'A', amount: 3000, discount: 300 }] },
        { enrollmentId: 101, studentId: 2, items: [{ feeTypeId: 1, description: 'A', amount: 3000, discount: 0 }] },
      ],
      header,
      db as never,
    );

    expect(out).toEqual([{ id: 9, enrollmentId: 100, totalAmount: 2700 }]);
    const itemRows = JSON.parse(calls[2].params[0] as string) as Array<{ invoice_id: number }>;
    expect(itemRows.every((r) => r.invoice_id === 9)).toBe(true);
    const totalIds = JSON.parse(calls[3].params[0] as string) as Array<{ invoice_id: number }>;
    expect(totalIds).toEqual([{ invoice_id: 9 }]);
  });

  it('stops before writing items when every invoice was already billed', async () => {
    const { db, calls } = fakeDb([
      { rows: [{ n: '30' }] },
      { rows: [] }, // conflict skip: nothing inserted
    ]);
    const out = await repo(db).createInvoicesBatch(
      [{ enrollmentId: 100, studentId: 1, items: [{ feeTypeId: 1, description: 'A', amount: 1, discount: 0 }] }],
      header,
      db as never,
    );
    expect(out).toEqual([]);
    expect(calls).toHaveLength(2); // sequence + insert, then bail
  });

  it('reads totals only after the line items, because a trigger computes them', async () => {
    const { db, calls } = fakeDb([
      { rows: [{ n: '40' }] },
      { rows: [{ id: 11, enrollment_id: 100 }] },
      { rows: [] },
      { rows: [{ id: 11, enrollment_id: 100, total_amount: '500.00' }] },
    ]);
    await repo(db).createInvoicesBatch(
      [{ enrollmentId: 100, studentId: 1, items: [{ feeTypeId: 1, description: 'A', amount: 500, discount: 0 }] }],
      header,
      db as never,
    );
    const itemsIdx = calls.findIndex((c) => c.sql.includes('INSERT INTO invoice_items'));
    const totalsIdx = calls.findIndex((c) => c.sql.includes('WITH billed AS'));
    expect(itemsIdx).toBeGreaterThan(-1);
    expect(totalsIdx).toBeGreaterThan(itemsIdx);
  });

  it('posts the ledger charge in SQL from the database-computed total, only when positive', async () => {
    const { db, calls } = fakeDb([
      { rows: [{ n: '50' }] },
      { rows: [{ id: 12, enrollment_id: 100 }] },
      { rows: [] },
      { rows: [{ id: 12, enrollment_id: 100, total_amount: '0.00' }] },
    ]);
    await repo(db).createInvoicesBatch(
      [{ enrollmentId: 100, studentId: 1, items: [{ feeTypeId: 1, description: 'A', amount: 0, discount: 0 }] }],
      header,
      db as never,
    );
    const totalsSql = calls[calls.length - 1].sql;
    expect(totalsSql).toContain("'charge'");
    expect(totalsSql).toContain('b.total_amount > 0');
    expect(totalsSql).toContain('i.total_amount'); // the value comes from the invoice row, not from JS
  });

  it('returns numbers, not the strings the driver gives for bigint/numeric', async () => {
    const { db } = fakeDb([
      { rows: [{ n: '60' }] },
      { rows: [{ id: '13', enrollment_id: '100' }] },
      { rows: [] },
      { rows: [{ id: '13', enrollment_id: '100', total_amount: '1234.56' }] },
    ]);
    const out = await repo(db).createInvoicesBatch(
      [{ enrollmentId: 100, studentId: 1, items: [{ feeTypeId: 1, description: 'A', amount: 1, discount: 0 }] }],
      header,
      db as never,
    );
    expect(out).toEqual([{ id: 13, enrollmentId: 100, totalAmount: 1234.56 }]);
    expect(typeof out[0].totalAmount).toBe('number');
  });
});
