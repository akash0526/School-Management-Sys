import { describe, expect, it } from 'vitest';
import { allocateFifo, discountFor, feeLinesFor } from '../../src/modules/fees/business/fees.service.js';

describe('discountFor', () => {
  const amount = 3000;
  it('applies percent and fixed discounts for the matching fee type and "all fees" discounts', () => {
    expect(
      discountFor(amount, 1, [
        { enrollmentId: 1, feeTypeId: 1, discountType: 'percent', value: 10 }, // 300
        { enrollmentId: 1, feeTypeId: null, discountType: 'fixed', value: 200 }, // all types
        { enrollmentId: 1, feeTypeId: 2, discountType: 'fixed', value: 999 }, // other type: ignored
      ]),
    ).toBe(500);
  });
  it('never discounts more than the amount', () => {
    expect(discountFor(amount, 1, [{ enrollmentId: 1, feeTypeId: null, discountType: 'percent', value: 100 }, { enrollmentId: 1, feeTypeId: 1, discountType: 'fixed', value: 500 }])).toBe(3000);
  });
  it('rounds to paisa', () => {
    expect(discountFor(1000, 1, [{ enrollmentId: 1, feeTypeId: 1, discountType: 'percent', value: 33.33 }])).toBe(333.3);
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
