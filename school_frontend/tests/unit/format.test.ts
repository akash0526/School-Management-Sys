import { describe, expect, it } from 'vitest';
import { clean, date, dateTime, fullName, gpa, initials, localDate, money, pct, titleCase, today } from '../../src/lib/format.js';

describe('localDate / today — never the UTC date', () => {
  /**
   * The bug this guards: `toISOString().slice(0,10)` is the UTC date. In Nepal (UTC+5:45)
   * that is YESTERDAY until 05:45 local, so "today's attendance" opened on the wrong day
   * every single morning. These assertions run in whatever TZ the runner uses, so they
   * assert the invariant (local components in, same components out) rather than a fixed
   * string — which is exactly what the UTC version violates.
   */
  it('reports the local calendar day, not the UTC one', () => {
    // 00:05 local on 22 Nov: UTC is still 21 Nov for Nepal, and for any positive offset.
    const justAfterMidnight = new Date(2026, 10, 22, 0, 5, 0);
    expect(localDate(justAfterMidnight)).toBe('2026-11-22');
    // the expression that used to be there, for contrast
    const off = justAfterMidnight.getTimezoneOffset();
    if (off < 0) expect(justAfterMidnight.toISOString().slice(0, 10)).not.toBe('2026-11-22');
  });

  it('zero-pads month and day', () => {
    expect(localDate(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('survives the last hour before midnight', () => {
    expect(localDate(new Date(2026, 10, 21, 23, 59, 59))).toBe('2026-11-21');
  });

  it('today() returns a well-formed date matching localDate(now)', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today()).toBe(localDate(new Date()));
  });
});

describe('money — Nepali grouping', () => {
  it('formats with the Rs. prefix and two decimals', () => {
    expect(money(0)).toBe('Rs. 0.00');
    expect(money(1234.5)).toBe('Rs. 1,234.50');
  });

  it('uses lakh-style grouping (1,23,456) for large amounts', () => {
    // a school fee total is routinely over 100,000
    expect(money(123456)).toBe('Rs. 1,23,456.00');
  });

  it('shows an em dash for missing values rather than Rs. 0', () => {
    // "no fee recorded" and "a fee of zero" are different things on a statement
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });

  it('accepts numeric strings, because JSON gives bigint numeric columns as text', () => {
    expect(money('2700.00' as unknown as number)).toBe('Rs. 2,700.00');
  });

  it('keeps a negative balance visible (advance credit)', () => {
    expect(money(-300)).toBe('Rs. -300.00');
  });
});

describe('date / dateTime', () => {
  it('formats a plain YYYY-MM-DD as a calendar date without shifting the day', () => {
    // parsed as local midnight on purpose: `new Date('2026-11-22')` is UTC midnight,
    // which is 05:45 the SAME day in Nepal but the PREVIOUS day west of UTC.
    expect(date('2026-11-22')).toBe('22 Nov 2026');
    expect(date('2026-01-01')).toBe('01 Jan 2026');
  });

  it('passes an unrecognised value through instead of showing Invalid Date', () => {
    expect(date('not-a-date')).toBe('not-a-date');
  });

  it('shows an em dash when there is no date', () => {
    expect(date(null)).toBe('—');
    expect(dateTime(undefined)).toBe('—');
  });

  it('keeps the time of a full timestamp', () => {
    expect(dateTime('2026-11-22T08:30:00Z')).toMatch(/22 Nov 2026/);
  });
});

describe('fullName / initials / titleCase', () => {
  it('skips a missing middle name instead of leaving a double space', () => {
    expect(fullName({ firstName: 'Sita', lastName: 'Sharma' })).toBe('Sita Sharma');
    expect(fullName({ firstName: 'Sita', middleName: 'K', lastName: 'Sharma' })).toBe('Sita K Sharma');
    expect(fullName({ firstName: 'Sita', middleName: null, lastName: 'Sharma' })).toBe('Sita Sharma');
  });

  it('takes at most two initials', () => {
    expect(initials('Sita Kumari Sharma')).toBe('SK');
    expect(initials('Sita')).toBe('S');
    expect(initials('  Sita   Sharma  ')).toBe('SS');
  });

  it('turns snake_case status values into readable labels', () => {
    expect(titleCase('in_progress')).toBe('In Progress');
    expect(titleCase(null)).toBe('—');
  });
});

describe('pct / gpa — a zero must not look like "no result"', () => {
  it('shows 0.00 for a real zero and an em dash for a missing value', () => {
    // a student who scored nothing is NOT the same as one not yet marked
    expect(pct(0)).toBe('0.00%');
    expect(pct(null)).toBe('—');
    expect(gpa(0)).toBe('0.00');
    expect(gpa(null)).toBe('—');
  });

  it('rounds to two places', () => {
    expect(gpa(3.456)).toBe('3.46');
    expect(pct(66.666)).toBe('66.67%');
  });
});

describe('clean — preparing a form for the API', () => {
  it('turns whitespace-only strings into null and trims real ones', () => {
    expect(clean({ a: '  x  ', b: '   ', c: 'ok' })).toEqual({ a: 'x', b: null, c: 'ok' });
  });

  it('drops undefined keys so a PATCH does not clear a field it never mentioned', () => {
    // undefined means "leave unchanged"; null means "clear". Merging those would wipe data.
    expect(clean({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('keeps numbers, booleans and null untouched', () => {
    expect(clean({ n: 0, t: false, z: null })).toEqual({ n: 0, t: false, z: null });
  });
});
