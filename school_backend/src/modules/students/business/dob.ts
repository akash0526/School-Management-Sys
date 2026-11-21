/**
 * Date-of-birth rules, as pure functions so they can be tested with an explicit clock.
 *
 * Dates are compared as 'YYYY-MM-DD' strings and never as Date objects:
 *
 *  - `new Date('2015-01-01')` is parsed as UTC midnight. In Kathmandu (UTC+5:45) that is
 *    05:45 on the same day, but any code that treats it as local time is off by a day.
 *  - `new Date().toISOString().slice(0,10)` is the date in UTC, which is still YESTERDAY in
 *    Nepal until 05:45 local. An admission entered just after midnight would be compared
 *    against the wrong day and a valid one-day-old admission was rejected.
 *
 * Fixed-width ISO dates sort and compare correctly as strings, which removes the whole
 * class of timezone bugs.
 */

export type DobProblem = 'not-before-admission' | 'in-future';

/**
 * Returns the problem with a date of birth, or null when it is acceptable.
 *
 * @param dob           'YYYY-MM-DD' date of birth
 * @param admissionDate 'YYYY-MM-DD' admission date; defaults to today in Nepal
 * @param today         'YYYY-MM-DD' today in Nepal (injectable for tests)
 */
export function dobProblem(dob: string, admissionDate: string | null | undefined, today: string): DobProblem | null {
  // A person is born before they are admitted. Same day is refused: a newborn cannot
  // start school the day they are born, and it catches a swapped dob/admission entry.
  if (dob >= (admissionDate ?? today)) return 'not-before-admission';
  if (dob > today) return 'in-future';
  return null;
}

export const dobMessage = (problem: DobProblem): string =>
  problem === 'in-future' ? 'Date of birth cannot be in the future' : 'Date of birth must be before the admission date';
