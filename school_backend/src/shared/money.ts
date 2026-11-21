/**
 * NUMBER ROUNDING — one implementation, used for money and for marks.
 *
 * Money and percentages are stored as NUMERIC in PostgreSQL, but the API computes with
 * JavaScript numbers (doubles). A double cannot represent 0.1 exactly, so sums drift:
 * three lines of 33.33 add up to 99.99000000000001. Every intermediate value is therefore
 * rounded back to 2 decimal places, and it must be done in exactly ONE way everywhere —
 * two slightly different `round2`s in different modules is how totals stop matching.
 */

/**
 * Round to 2 decimals (paisa, or NEB grade points / percentages).
 *
 * Two things make this less trivial than `Math.round(n * 100) / 100`:
 *
 * 1. **Symmetry.** `Math.round` sends .5 towards +Infinity, so -1.005 → -1.00 while
 *    1.005 → 1.01. A charge and its exact reversal would not cancel, and money balances
 *    here are legitimately negative (advance credit). So the magnitude is rounded and the
 *    sign re-applied.
 * 2. **Binary representation.** 1.005 is really 1.00499999999999989, so a naive round
 *    turns a clerk's 1.005 into 1.00 and loses a paisa. The EPSILON nudge corrects that
 *    without affecting values that are already representable.
 *
 * Negative zero is normalised to 0 so it never reaches JSON or an equality check.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n; // NaN / Infinity must surface, not be masked
  const sign = n < 0 ? -1 : 1;
  const rounded = (sign * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** True when two money amounts are equal to the paisa (never compare doubles with ===). */
export const moneyEquals = (a: number, b: number): boolean => round2(a) === round2(b);
