import { badRequest } from '../../../shared/errors.js';

/**
 * PASSWORD POLICY — enforced in the business layer, so no API (users, staff, students,
 * guardians, change-password) can bypass it with a looser schema.
 *
 *  - 10+ characters, at least one letter and one digit
 *  - at most 72 bytes (bcrypt silently ignores anything longer)
 *  - not a commonly used / guessable password, not containing the username
 */
const COMMON = new Set(
  [
    'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1', 'qwerty123', 'qwertyuiop',
    '1234567890', '0123456789', '1q2w3e4r5t', 'abc1234567', 'abcd123456', 'iloveyou1', 'welcome123', 'welcome1',
    'admin12345', 'admin@123', 'administrator', 'letmein123', 'changeme123', 'trustno1', 'football1', 'monkey1234',
    // local / school-specific guesses
    'nepal12345', 'nepal@123', 'kathmandu1', 'kathmandu123', 'school1234', 'school@123', 'school12345', 'teacher123',
    'student123', 'principal1', 'butwal1234', 'pokhara123', 'lalitpur123', 'namaste123', 'everest123',
  ].map((p) => p.toLowerCase()),
);

/** Words that are weak no matter which digits/symbols are added around them. */
const COMMON_WORDS = new Set([
  'password', 'passwd', 'pass', 'qwerty', 'qwertyuiop', 'asdf', 'abc', 'abcd', 'admin', 'administrator', 'welcome', 'letmein',
  'iloveyou', 'changeme', 'secret', 'login', 'user', 'test', 'monkey', 'dragon', 'football', 'cricket',
  'nepal', 'kathmandu', 'pokhara', 'lalitpur', 'butwal', 'bhaktapur', 'everest', 'namaste', 'himal',
  'school', 'teacher', 'student', 'principal', 'parent', 'guardian', 'staff', 'class', 'exam',
]);

export function passwordProblems(password: string, ctx: { username?: string | null } = {}): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('must be at least 10 characters');
  if (Buffer.byteLength(password, 'utf8') > 72) problems.push('must be at most 72 bytes');
  if (!/\p{L}/u.test(password)) problems.push('must contain a letter'); // any script — Devanagari counts
  if (!/\p{Nd}/u.test(password)) problems.push('must contain a number'); // ० १ २ … count too
  const lower = password.toLowerCase();
  // exact list, or a common word dressed up with digits/symbols ("Password@123", "Nepal2083!", "school#1")
  const lettersOnly = lower.replace(/[^\p{L}]/gu, '');
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z0-9@]/g, '')) || COMMON_WORDS.has(lettersOnly)) problems.push('is too common');
  if (/^(.)\1+$/.test(password)) problems.push('must not repeat a single character');
  const user = ctx.username?.toLowerCase();
  if (user && user.length >= 3 && lower.includes(user)) problems.push('must not contain the username');
  return problems;
}

export function assertStrongPassword(password: string, ctx: { username?: string | null } = {}) {
  const problems = passwordProblems(password, ctx);
  if (problems.length) throw badRequest(`Password ${problems.join(', ')}`, { problems });
}
