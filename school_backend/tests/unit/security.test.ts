import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../src/shared/auth/types.js';
import type { SecurityEvent } from '../../src/shared/security/securityLog.js';
import { passwordProblems } from '../../src/modules/auth/business/passwordPolicy.js';
import { SessionGate } from '../../src/modules/auth/business/security.js';
import { UsersService } from '../../src/modules/auth/business/users.service.js';
import { isLocalDatabase, loadEnv, securityProblems } from '../../src/config/env.js';
import { LookupThrottle } from '../../src/modules/public/business/public.service.js';
import { generateTemporaryPassword, LoginThrottle } from '../../src/modules/auth/business/security.js';
import { containsPattern } from '../../src/shared/db/sql.js';
import { fromDatabaseError } from '../../src/shared/errors.js';

// ───────────────────────── password policy
describe('password policy', () => {
  it('accepts a strong password', () => expect(passwordProblems('Himal@Peak2083', { username: 'sita' })).toEqual([]));
  it.each([
    ['Short1', 'at least 10'],
    ['onlyletterspassword', 'number'],
    ['12345678901', 'letter'],
    ['Password123', 'too common'],
    ['Nepal@123', 'at least 10'],
    ['school12345', 'too common'],
    ['sitasharma2083', 'username'],
  ])('rejects %s (%s)', (pw, why) => {
    expect(passwordProblems(pw, { username: 'sitasharma' }).join(' ')).toContain(why);
  });
  it('rejects passwords longer than bcrypt can use (72 bytes)', () => {
    expect(passwordProblems('ए'.repeat(25) + 'a1').join(' ')).toContain('72 bytes'); // 25 × 3 bytes
  });
});

describe('password policy — review fixes', () => {
  it('Devanagari letters and digits count (Nepali passwords are allowed)', () => {
    expect(passwordProblems('सगरमाथा2083हिमाल')).toEqual([]);
    expect(passwordProblems('मेरोघरबुटवल२०८३')).toEqual([]); // Devanagari digits
  });
  it.each(['Password@123', 'Nepal2083!!', 'School#2083!', 'Admin!!2083', 'Kathmandu@99'])('rejects common word + decoration: %s', (pw) => {
    expect(passwordProblems(pw).join()).toContain('too common');
  });
  it('still accepts real passphrases', () => {
    for (const pw of ['Admin@School2083!', 'Teacher@2083secure', 'Himal@Peak2083']) expect(passwordProblems(pw)).toEqual([]);
  });
});

describe('throttles keep bounded memory without letting attackers reset them', () => {
  it('LookupThrottle: flooding other numbers does not unblock the targeted one', () => {
    const t = new LookupThrottle(5, 60_000, 100);
    for (let i = 0; i < 5; i++) t.fail('target');
    expect(() => t.assertAllowed('target')).toThrow();
    for (let i = 0; i < 1_000; i++) t.fail(`junk-${i}`);
    expect(() => t.assertAllowed('target')).toThrow(); // still blocked
  });
  it('LoginThrottle: memory is bounded and locked accounts stay locked under flooding', () => {
    const t = new LoginThrottle(5, 60_000, 100);
    for (let i = 0; i < 5; i++) t.recordFailure('principal');
    for (let i = 0; i < 1_000; i++) t.recordFailure(`random-${i}`);
    expect(t.isLocked('principal')).toBe(true);
    expect((t as any).failures.size).toBeLessThanOrEqual(101);
  });
});

describe('temporary passwords', () => {
  it('have the expected shape and no ambiguous characters', () => {
    for (let i = 0; i < 200; i++) expect(generateTemporaryPassword()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
  });
  it('use the whole alphabet roughly uniformly (no modulo bias)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) for (const c of generateTemporaryPassword().replace(/-/g, '')) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(56);
    const values = [...counts.values()];
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.4); // biased version is ~2×
  });
});

// ───────────────────────── anti-escalation (fake repo, no DB)
const ROLE_PERMS: Record<string, string[]> = {
  super_admin: ['users.manage', 'fees.cancel_receipt', 'students.view', 'marks.enter'],
  principal: ['students.view', 'marks.enter', 'staff.manage'],
  accountant: ['students.view', 'fees.cancel_receipt'],
  teacher: ['students.view', 'marks.enter'],
  it_admin: ['users.manage', 'students.view'],
  parent: [],
};
const USER_ROLES: Record<number, string[]> = { 1: ['super_admin'], 2: ['principal'], 3: ['teacher'], 4: ['accountant'], 5: ['it_admin'], 6: ['parent'] };

function makeService() {
  const events: SecurityEvent[] = [];
  const perms = (roles: string[]) => [...new Set(roles.flatMap((r) => ROLE_PERMS[r] ?? []))];
  const repo: any = {
    findExistingRoles: async (names: string[]) => names.filter((n) => n in ROLE_PERMS),
    permissionsOfRoles: async (names: string[]) => perms(names),
    findUserById: async (id: number) => (USER_ROLES[id] ? { id, username: `u${id}` } : null),
    getRolesAndPermissions: async (id: number) => ({ roles: USER_ROLES[id], permissions: perms(USER_ROLES[id]) }),
    createUser: vi.fn(async () => 99),
    replaceRoles: vi.fn(async () => undefined),
    updatePassword: vi.fn(async () => undefined),
    revokeAllSessions: vi.fn(async () => undefined),
    updateUser: vi.fn(async () => true),
  };
  const tx: any = { transaction: (_a: unknown, fn: (t: unknown) => unknown) => fn({}) };
  const hasher: any = { hash: async () => 'hash', verify: async () => true };
  const gate = new SessionGate(async () => true);
  const svc = new UsersService(repo, tx, hasher, gate, { record: (e) => events.push(e) });
  return { svc, repo, events };
}
const actor = (id: number): AuthUser => ({
  userId: id, username: `u${id}`, roles: USER_ROLES[id], permissions: [...new Set(USER_ROLES[id].flatMap((r) => ROLE_PERMS[r]))],
  staffId: null, studentId: null, guardianId: null, mustChangePassword: false, sessionId: 'x',
});

describe('anti-escalation: granting roles', () => {
  it('principal can create a teacher login (teacher ⊆ principal)', async () => {
    const { svc } = makeService();
    await expect(svc.createAccount(actor(2), { username: 'newteacher', roles: ['teacher'] })).resolves.toMatchObject({ userId: 99 });
  });
  it('principal CANNOT create an accountant login (would gain fees.cancel_receipt)', async () => {
    const { svc, repo, events } = makeService();
    await expect(svc.createAccount(actor(2), { username: 'fake', roles: ['accountant'] })).rejects.toMatchObject({ status: 403 });
    expect(repo.createUser).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'privilege_escalation_blocked', details: { missing: ['fees.cancel_receipt'] } });
  });
  it('nobody but a super_admin can grant super_admin', async () => {
    const { svc } = makeService();
    await expect(svc.createAccount(actor(5), { username: 'x', roles: ['super_admin'] })).rejects.toMatchObject({ status: 403 });
    await expect(svc.createAccount(actor(1), { username: 'x', roles: ['super_admin'], password: 'Strong#Pass2083' })).resolves.toBeTruthy();
  });
  it('unknown roles are rejected', async () => {
    const { svc } = makeService();
    await expect(svc.createAccount(actor(1), { username: 'x', roles: ['god_mode'] })).rejects.toMatchObject({ status: 400 });
  });
  it('weak initial password is rejected for every caller', async () => {
    const { svc } = makeService();
    await expect(svc.createAccount(actor(1), { username: 'x', roles: ['parent'], password: 'Password123' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('anti-escalation: managing accounts', () => {
  it('a users.manage admin CANNOT reset a super_admin password (account takeover)', async () => {
    const { svc, repo } = makeService();
    await expect(svc.resetPassword(actor(5), 1)).rejects.toMatchObject({ status: 403 });
    expect(repo.updatePassword).not.toHaveBeenCalled();
  });
  it('cannot reset/deactivate/re-role an account with permissions you lack', async () => {
    const { svc } = makeService();
    await expect(svc.resetPassword(actor(5), 4)).rejects.toMatchObject({ status: 403 }); // accountant has fees.cancel_receipt
    await expect(svc.update(actor(5), 2, { isActive: false })).rejects.toMatchObject({ status: 403 }); // principal
    await expect(svc.setRoles(actor(5), 4, ['parent'])).rejects.toMatchObject({ status: 403 });
  });
  it('can manage a less privileged account (parent ⊆ it_admin), and that revokes its sessions', async () => {
    const { svc, repo } = makeService();
    const r = await svc.resetPassword(actor(5), 6);
    expect(r.temporaryPassword).toBeTruthy();
    expect(repo.revokeAllSessions).toHaveBeenCalledWith(6, expect.anything());
    await expect(svc.resetPassword(actor(5), 3)).rejects.toMatchObject({ status: 403 }); // teacher has marks.enter, it_admin doesn't
  });
  it('super_admin can manage anyone; reset revokes sessions', async () => {
    const { svc, repo, events } = makeService();
    const r = await svc.resetPassword(actor(1), 3);
    expect(r.temporaryPassword).toMatch(/^\S{4}-\S{4}-\S{4}$/);
    expect(repo.revokeAllSessions).toHaveBeenCalledWith(3, expect.anything());
    expect(events.at(-1)?.type).toBe('password_reset');
  });
  it('non-super admins cannot change their own roles', async () => {
    const { svc } = makeService();
    await expect(svc.setRoles(actor(5), 5, ['it_admin', 'accountant'])).rejects.toMatchObject({ status: 403 });
  });
});

describe('leaving the school switches the login off', () => {
  it('deactivates and revokes sessions inside the caller transaction', async () => {
    const { svc, repo, events } = makeService();
    const t = { marker: 'caller-tx' };
    await svc.deactivateLinkedAccount(actor(2), 3, 'staff status → resigned', t as any);
    expect(repo.updateUser).toHaveBeenCalledWith(3, { isActive: false }, t);
    expect(repo.revokeAllSessions).toHaveBeenCalledWith(3, t);
    expect(events.at(-1)).toMatchObject({ type: 'account_deactivated', targetUserId: 3, details: { reason: 'staff status → resigned' } });
  });
  it('cannot be used to lock out a more privileged account', async () => {
    const { svc, repo } = makeService();
    await expect(svc.deactivateLinkedAccount(actor(2), 1, 'staff status → terminated', {} as any)).rejects.toMatchObject({ status: 403 });
    expect(repo.updateUser).not.toHaveBeenCalled();
  });
  it('cannot deactivate yourself', async () => {
    const { svc } = makeService();
    await expect(svc.deactivateLinkedAccount(actor(2), 2, 'x', {} as any)).rejects.toMatchObject({ status: 400 });
  });
});

describe('database errors map to safe client errors (never a 500 with internals)', () => {
  it.each([
    ['22001', 400], ['22003', 400], ['23505', 409], ['23503', 400], ['23514', 400], ['40001', 409], ['40P01', 409], ['57014', 503],
  ])('%s → %i', (code, status) => {
    const e = fromDatabaseError({ code, message: 'value too long for type character varying(30)', detail: 'Key (x)=(secret)' });
    expect(e?.status).toBe(status);
    expect(e?.message).not.toMatch(/varying|secret|Key \(/);
  });
  it('unknown errors are not mapped (logged server-side, generic 500 to client)', () => {
    expect(fromDatabaseError({ code: 'XX000' })).toBeNull();
    expect(fromDatabaseError(new Error('boom'))).toBeNull();
  });
});

describe('search patterns', () => {
  it('treats % _ and \\ literally', () => {
    expect(containsPattern('ram')).toBe('%ram%');
    expect(containsPattern('100%_a\\b')).toBe('%100\\%\\_a\\\\b%');
  });
});

// ───────────────────────── session gate
describe('SessionGate', () => {
  it('caches lookups and forgets a user immediately on revocation', async () => {
    let active = true;
    const lookup = vi.fn(async () => active);
    const gate = new SessionGate(lookup, 60_000);
    expect(await gate.check('s1', 7)).toBe(true);
    expect(await gate.check('s1', 7)).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1); // cached
    active = false;
    gate.forgetUser(7);
    expect(await gate.check('s1', 7)).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it('a session id never validates for a different user', async () => {
    const gate = new SessionGate(async () => true);
    await gate.check('s1', 7);
    expect(await gate.check('s1', 8)).toBe(false);
  });
});

// ───────────────────────── configuration
describe('startup configuration checks', () => {
  const base = loadEnv({ DATABASE_URL: 'postgres://a:b@localhost/x', JWT_ACCESS_SECRET: 'q8Zr2LkVw9Yt4NbXc7Hm1PsDf6Gj3Ua0', NODE_ENV: 'development' } as any);
  it('rejects placeholder JWT secrets', () => {
    expect(securityProblems({ ...base, JWT_ACCESS_SECRET: 'replace-with-at-least-32-random-characters-xxxxxxxx' }).join()).toContain('placeholder');
    expect(securityProblems({ ...base, JWT_ACCESS_SECRET: 'a'.repeat(40) }).join()).toContain('variety');
  });
  it('rejects long-lived access tokens', () => {
    expect(securityProblems({ ...base, JWT_ACCESS_TTL: '7d' }).join()).toContain('JWT_ACCESS_TTL');
  });
  it('production requires secure cookies, https CORS, bcrypt ≥12, TLS to remote DB', () => {
    const p = securityProblems({ ...base, NODE_ENV: 'production', COOKIE_SECURE: false, CORS_ORIGINS: ['http://x'], BCRYPT_ROUNDS: 10, DATABASE_URL: 'postgres://a:b@db.example/x' }).join('\n');
    for (const k of ['COOKIE_SECURE', 'CORS_ORIGINS', 'BCRYPT_ROUNDS', 'DB_SSL']) expect(p).toContain(k);
  });
  it('only a really local DB host is exempt from DB_SSL', () => {
    expect(isLocalDatabase('postgres://a:b@localhost:5432/x')).toBe(true);
    expect(isLocalDatabase('postgres://a:b@127.0.0.1/x')).toBe(true);
    expect(isLocalDatabase('postgres://a:b@[::1]/x')).toBe(true);
    expect(isLocalDatabase('postgres://a:b@localhost.evil.example/x')).toBe(false);
    expect(isLocalDatabase('postgres://a:b@db.school.edu.np/x')).toBe(false);
  });
  it('production CORS must be https origins only', () => {
    const prod = { ...base, NODE_ENV: 'production' as const, COOKIE_SECURE: true, BCRYPT_ROUNDS: 12 };
    expect(securityProblems({ ...prod, CORS_ORIGINS: ['https://portal.school.edu.np'] })).toEqual([]);
    for (const bad of ['null', 'portal.school.edu.np', 'https://*.school.edu.np', 'http://x']) {
      expect(securityProblems({ ...prod, CORS_ORIGINS: [bad] }).join()).toContain('CORS_ORIGINS');
    }
  });
  it('NODE_ENV defaults to production (no debug output by accident)', () => {
    expect(loadEnv({ DATABASE_URL: 'postgres://a:b@localhost/x', JWT_ACCESS_SECRET: base.JWT_ACCESS_SECRET, COOKIE_SECURE: 'true', BCRYPT_ROUNDS: '12' } as any).NODE_ENV).toBe('production');
  });
});
