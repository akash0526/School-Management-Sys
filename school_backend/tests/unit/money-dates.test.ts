import { describe, expect, it } from 'vitest';
import { round2, moneyEquals } from '../../src/shared/money.js';
import { dobMessage, dobProblem } from '../../src/modules/students/business/dob.js';

describe('round2 — money and percentages', () => {
  it.each([
    [0.1 + 0.2, 0.3],
    [1.005, 1.01],
    [2.675, 2.68],
    [8.835, 8.84],
    [100, 100],
    [0, 0],
    [1234.564, 1234.56],
    [1234.565, 1234.57],
  ])('%s → %s', (input, expected) => {
    expect(round2(input)).toBe(expected);
  });

  it('rounds negatives symmetrically, so a charge and its reversal cancel', () => {
    // this is the bug: Math.round(.5) goes towards +Infinity, so -1.005 became -1.00
    // while 1.005 became 1.01 — a debit and an exact credit would not net to zero
    for (const v of [1.005, 2.675, 0.125, 8.835, 1234.565]) {
      expect(round2(-v)).toBe(-round2(v));
    }
  });

  it('a charge and its exact reversal net to exactly zero', () => {
    for (const v of [1234.565, 1.005, 0.125]) {
      expect(round2(v) + round2(-v)).toBe(0);
    }
  });

  it('never returns negative zero', () => {
    expect(Object.is(round2(-0.001), 0)).toBe(true);
    expect(Object.is(round2(-0), 0)).toBe(true);
  });

  it('does not mask NaN or Infinity', () => {
    expect(Number.isNaN(round2(NaN))).toBe(true);
    expect(round2(Infinity)).toBe(Infinity);
    expect(round2(-Infinity)).toBe(-Infinity);
  });

  it('is idempotent', () => {
    for (const v of [1.005, 2.675, -8.835, 99.999]) expect(round2(round2(v))).toBe(round2(v));
  });

  it('summing 300 awkward lines does not drift when each step is rounded', () => {
    const lines = Array.from({ length: 300 }, (_, i) => 1234.56 + (i % 7) * 0.01);
    let total = 0;
    for (const l of lines) total = round2(total + l);
    // must be an exact 2-decimal value, not 370376.9699999997
    expect(total).toBe(370376.97);
    expect(String(total)).not.toMatch(/9{6,}/);
  });

  it('moneyEquals compares to the paisa', () => {
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(moneyEquals(0.1 + 0.2, 0.31)).toBe(false);
    expect(moneyEquals(1.005, 1.01)).toBe(true);
  });
});

describe('dobProblem — date of birth rules', () => {
  const today = '2026-11-22';

  it('accepts a birth date before the admission date', () => {
    expect(dobProblem('2014-05-10', '2026-11-22', today)).toBeNull();
  });

  it('rejects a birth date equal to the admission date', () => {
    expect(dobProblem('2026-11-22', '2026-11-22', today)).toBe('not-before-admission');
  });

  it('rejects a birth date after the admission date', () => {
    expect(dobProblem('2026-12-01', '2026-11-22', today)).toBe('not-before-admission');
  });

  it('falls back to today in Nepal when no admission date is given', () => {
    expect(dobProblem('2026-11-21', null, today)).toBeNull();
    expect(dobProblem('2026-11-22', null, today)).toBe('not-before-admission');
  });

  it('rejects a future date of birth', () => {
    expect(dobProblem('2027-01-01', '2027-06-01', today)).toBe('in-future');
  });

  /**
   * The regression this specifically protects: between 00:00 and 05:45 Nepal time the UTC
   * date is still YESTERDAY. The old code used `new Date().toISOString().slice(0,10)`, so a
   * child born the previous day and admitted now was rejected as "born on/after admission".
   * `today` here is the Nepal date derived from a UTC instant that is still the 21st.
   */
  it('after midnight in Nepal (UTC still yesterday) accepts a one-day-old admission', () => {
    const utcInstant = new Date('2026-11-21T18:20:00Z'); // 00:05 on 2026-11-22 in Kathmandu
    const nepalToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(utcInstant);
    const utcToday = utcInstant.toISOString().slice(0, 10);
    expect(utcToday).toBe('2026-11-21'); // the trap
    expect(nepalToday).toBe('2026-11-22');
    expect(dobProblem('2026-11-21', null, nepalToday)).toBeNull();
    // the old logic compared against utcToday and rejected it:
    expect('2026-11-21' >= utcToday).toBe(true);
  });

  it('does not shift a date parsed by Date() (UTC midnight vs local midnight)', () => {
    // a Date-based comparison treats '2026-11-22' as 00:00 UTC = 05:45 Nepal,
    // so a dob of the 21st "looks" fine while a dob of the 22nd 05:00 looks early.
    // String comparison has no such ambiguity.
    expect(new Date('2026-11-22').toISOString()).toBe('2026-11-22T00:00:00.000Z');
    expect(dobProblem('2026-11-21', '2026-11-22', today)).toBeNull();
  });
});

describe('dobMessage', () => {
  it('explains each problem', () => {
    expect(dobMessage('in-future')).toMatch(/future/);
    expect(dobMessage('not-before-admission')).toMatch(/before the admission date/);
  });
});
