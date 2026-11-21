import { describe, expect, it } from 'vitest';
import { allocateFifo, discountsForInvoice, feeLinesFor } from '../../src/modules/fees/business/fees.service.js';

describe('discountsForInvoice', () => {
  const one = [{ feeTypeId: 1, amount: 3000 }];

  it('applies percent and fixed discounts for the matching fee type', () => {
    expect(
      discountsForInvoice(one, [
        { enrollmentId: 1, feeTypeId: 1, discountType: 'percent', value: 10 }, // 300
        { enrollmentId: 1, feeTypeId: 1, discountType: 'fixed', value: 200 }, // 200
        { enrollmentId: 1, feeTypeId: 2, discountType: 'fixed', value: 999 }, // other type: ignored
      ]),
    ).toEqual([500]);
  });

  it('applies a fixed "all fee types" discount ONCE for the whole bill, not once per line', () => {
    const lines = [
      { feeTypeId: 1, amount: 3000 },
      { feeTypeId: 2, amount: 3000 },
      { feeTypeId: 3, amount: 3000 },
    ];
    const result = discountsForInvoice(lines, [{ enrollmentId: 1, feeTypeId: null, discountType: 'fixed', value: 500 }]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(500); // was 1500 before the fix
  });

  it('spreads a fixed "all fee types" discount over the lines in order and never over-discounts a line', () => {
    const lines = [
      { feeTypeId: 1, amount: 300 },
      { feeTypeId: 2, amount: 1000 },
    ];
    const result = discountsForInvoice(lines, [{ enrollmentId: 1, feeTypeId: null, discountType: 'fixed', value: 500 }]);
    expect(result).toEqual([300, 200]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(500);
  });

  it('applies an "all fee types" percent discount to every line (proportional, so equal to once on the bill)', () => {
    const lines = [
      { feeTypeId: 1, amount: 3000 },
      { feeTypeId: 2, amount: 1000 },
    ];
    const result = discountsForInvoice(lines, [{ enrollmentId: 1, feeTypeId: null, discountType: 'percent', value: 10 }]);
    expect(result).toEqual([300, 100]);
  });

  it('never discounts a line below zero, and drops a bill-wide discount larger than the bill', () => {
    const lines = [
      { feeTypeId: 1, amount: 1000 },
      { feeTypeId: 2, amount: 500 },
    ];
    const result = discountsForInvoice(lines, [
      { enrollmentId: 1, feeTypeId: 1, discountType: 'percent', value: 100 }, // 1000
      { enrollmentId: 1, feeTypeId: null, discountType: 'fixed', value: 9000 }, // more than the bill
    ]);
    expect(result).toEqual([1000, 500]);
  });

  it('combines per-type and bill-wide discounts without double-counting the bill-wide one', () => {
    const lines = [
      { feeTypeId: 1, amount: 2000 }, // TUITION: 10% off + fixed 500 bill-wide
      { feeTypeId: 2, amount: 1000 }, // EXAM: no per-type discount
    ];
    const result = discountsForInvoice(lines, [
      { enrollmentId: 1, feeTypeId: 1, discountType: 'percent', value: 10 }, // 200
      { enrollmentId: 1, feeTypeId: null, discountType: 'fixed', value: 500 }, // 500 once
    ]);
    expect(result).toEqual([700, 0]); // 200+500 on line 1, nothing left for line 2
    expect(result.reduce((a, b) => a + b, 0)).toBe(700);
  });

  it('rounds to paisa', () => {
    expect(discountsForInvoice([{ feeTypeId: 1, amount: 1000 }], [{ enrollmentId: 1, feeTypeId: 1, discountType: 'percent', value: 33.33 }])).toEqual([333.3]);
  });

  it('no discounts → every line gets 0', () => {
    expect(discountsForInvoice([{ feeTypeId: 1, amount: 3000 }, { feeTypeId: 2, amount: 500 }], [])).toEqual([0, 0]);
  });
});

describe('feeLinesFor', () => {
  const s = (classId: number, streamId: number | null, feeTypeId: number, amount: number) => ({ classId, streamId, feeTypeId, feeTypeName: `F${feeTypeId}`, amount });
  const structures = [s(11, null, 1, 4000), s(11, 1, 1, 5000), s(11, null, 2, 500), s(11, 2, 3, 800), s(10, null, 1, 3000)];

  it('stream-specific fee overrides the general one for that class', () => {
    const lines = feeLinesFor(11, 1, structures);
    expect(lines.find((l) => l.feeTypeId === 1)?.amount).toBe(5000);
    expect(lines.map((l) => l.feeTypeId).sort()).toEqual([1, 2]); // stream 2's lab fee not included
  });
  it('general fees only when student has no stream', () => {
    expect(feeLinesFor(11, null, structures).map((l) => [l.feeTypeId, l.amount])).toEqual([[1, 4000], [2, 500]]);
  });
  it('other classes are ignored', () => {
    expect(feeLinesFor(10, null, structures)).toHaveLength(1);
  });
});

describe('allocateFifo', () => {
  const invoices = [
    { id: 1, totalAmount: 2700, paidAmount: 2000 }, // due 700
    { id: 2, totalAmount: 3000, paidAmount: 0 },
    { id: 3, totalAmount: 500, paidAmount: 500 }, // already paid
  ];
  it('pays oldest first and keeps the remainder as advance', () => {
    expect(allocateFifo(5000, invoices)).toEqual({ allocations: [{ invoiceId: 1, amount: 700 }, { invoiceId: 2, amount: 3000 }], advance: 1300 });
  });
  it('partial payment stops at the first invoice it cannot fully cover', () => {
    expect(allocateFifo(1000, invoices)).toEqual({ allocations: [{ invoiceId: 1, amount: 700 }, { invoiceId: 2, amount: 300 }], advance: 0 });
  });
  it('handles decimals without floating point drift', () => {
    expect(allocateFifo(0.3, [{ id: 1, totalAmount: 0.1, paidAmount: 0 }, { id: 2, totalAmount: 0.2, paidAmount: 0 }])).toEqual({
      allocations: [{ invoiceId: 1, amount: 0.1 }, { invoiceId: 2, amount: 0.2 }],
      advance: 0,
    });
  });
  it('no open invoices → everything is advance', () => {
    expect(allocateFifo(100, [])).toEqual({ allocations: [], advance: 100 });
  });
});
