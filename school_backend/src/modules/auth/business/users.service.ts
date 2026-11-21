import type { Tx, TransactionRunner } from '../../../shared/db/database.js';
import type { AuthUser } from '../../../shared/auth/types.js';
import { badRequest, forbidden, notFound } from '../../../shared/errors.js';
import type { SecurityLog } from '../../../shared/security/securityLog.js';
import type { AuthRepository, PasswordHasher, RequestMeta } from './auth.ports.js';
import { assertStrongPassword } from './passwordPolicy.js';
import { generateTemporaryPassword, type SessionGate } from './security.js';

const SUPER_ADMIN = 'super_admin';
const isSuperAdmin = (u: AuthUser) => u.roles.includes(SUPER_ADMIN);
const noMeta: RequestMeta = { ip: null, userAgent: null };

/**
 * BUSINESS LAYER — user administration + the account service used by other modules.
 *
 * Anti-escalation rules (apply to EVERY caller: /users, staff, students, guardians):
 *  1. You can only GRANT roles whose permissions you already hold yourself.
 *     (A principal without fees.cancel_receipt cannot create an "accountant" login.)
 *  2. You can only MANAGE (reset password, change roles, deactivate) accounts whose
 *     permissions are a subset of yours. Nobody but a super_admin can touch a super_admin.
 */
export class UsersService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tx: TransactionRunner,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionGate,
    private readonly security: SecurityLog,
  ) {}

  list(search: string | undefined, limit: number, offset: number) {
    return this.repo.listUsers({ search, limit, offset });
  }

  listRoles() {
    return this.repo.listRoles();
  }

  /** Security monitoring: failed logins, lockouts, resets, role changes, blocked escalations, API-key misuse. */
  listSecurityEvents(f: Parameters<AuthRepository['listSecurityEvents']>[0]) {
    return this.repo.listSecurityEvents(f);
  }

  /**
   * Create a login. If no password is given a temporary one is generated and
   * the user must change it at first login. Used by the /users API AND by
   * the staff/students modules (through the UserAccountService port).
   */
  async createAccount(
    actor: AuthUser,
    input: { username: string; email?: string | null; phone?: string | null; password?: string; roles: string[] },
    tx?: Tx,
    meta: RequestMeta = noMeta,
  ) {
    await this.assertCanGrant(actor, input.roles, meta);
    if (input.password) assertStrongPassword(input.password, { username: input.username });
    const temporaryPassword = input.password ? undefined : generateTemporaryPassword();
    const passwordHash = await this.hasher.hash(input.password ?? temporaryPassword!);

    const run = async (t: Tx) => {
      const userId = await this.repo.createUser(
        { username: input.username, email: input.email, phone: input.phone, passwordHash, mustChangePassword: true },
        t,
      );
      await this.repo.replaceRoles(userId, input.roles, t);
      return userId;
    };
    const userId = tx ? await run(tx) : await this.tx.transaction(actor.userId, run);
    this.security.record({ type: 'account_created', actorUserId: actor.userId, targetUserId: userId, username: input.username, ...meta, details: { roles: input.roles } });
    return { userId, username: input.username, temporaryPassword };
  }

  async update(actor: AuthUser, userId: number, patch: { email?: string | null; phone?: string | null; isActive?: boolean }, meta: RequestMeta = noMeta) {
    if (patch.isActive === false && userId === actor.userId) throw badRequest('You cannot deactivate your own account');
    await this.assertCanManage(actor, userId, 'update', meta);
    const ok = await this.tx.transaction(actor.userId, async (t) => {
      const updated = await this.repo.updateUser(userId, patch, t);
      if (updated && patch.isActive === false) await this.repo.revokeAllSessions(userId, t);
      return updated;
    });
    if (!ok) throw notFound('User');
    if (patch.isActive !== undefined) {
      this.sessions.forgetUser(userId);
      this.security.record({ type: patch.isActive ? 'account_reactivated' : 'account_deactivated', actorUserId: actor.userId, targetUserId: userId, ...meta });
    }
  }

  /**
   * Port for other modules: the person behind this login has left (staff resigned/terminated,
   * student left/graduated) — the account stops working now. Runs inside the caller's transaction so
   * the status change and the deactivation commit or fail together. Same anti-escalation rule as
   * a manual deactivation: you cannot switch off an account that holds permissions you lack.
   */
  async deactivateLinkedAccount(actor: AuthUser, userId: number, reason: string, tx: Tx) {
    if (userId === actor.userId) throw badRequest('You cannot deactivate your own login this way');
    await this.assertCanManage(actor, userId, 'deactivate_on_leaving', noMeta);
    const changed = await this.repo.updateUser(userId, { isActive: false }, tx);
    if (changed) await this.repo.revokeAllSessions(userId, tx);
    // Dropped now; re-dropped shortly after commit so a lookup racing the commit can't keep a stale "active".
    this.sessions.forgetUser(userId);
    setTimeout(() => this.sessions.forgetUser(userId), 1_000).unref();
    this.security.record({ type: 'account_deactivated', actorUserId: actor.userId, targetUserId: userId, details: { reason } });
  }

  async setRoles(actor: AuthUser, userId: number, roles: string[], meta: RequestMeta = noMeta) {
    if (userId === actor.userId && isSuperAdmin(actor) && !roles.includes(SUPER_ADMIN)) {
      throw badRequest('You cannot remove your own super_admin role');
    }
    if (userId === actor.userId && !isSuperAdmin(actor)) throw forbidden('You cannot change your own roles');
    await this.assertCanManage(actor, userId, 'set_roles', meta);
    await this.assertCanGrant(actor, roles, meta);
    const before = await this.repo.getRolesAndPermissions(userId);
    await this.tx.transaction(actor.userId, async (t) => {
      await this.repo.replaceRoles(userId, roles, t);
      await this.repo.revokeAllSessions(userId, t); // force re-login so new permissions apply
    });
    this.sessions.forgetUser(userId);
    this.security.record({ type: 'roles_changed', severity: 'warning', actorUserId: actor.userId, targetUserId: userId, ...meta, details: { from: before.roles, to: roles } });
  }

  async resetPassword(actor: AuthUser, userId: number, meta: RequestMeta = noMeta) {
    await this.assertCanManage(actor, userId, 'reset_password', meta);
    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.hasher.hash(temporaryPassword);
    await this.tx.transaction(actor.userId, async (t) => {
      await this.repo.updatePassword(userId, hash, true, t);
      await this.repo.revokeAllSessions(userId, t);
    });
    this.sessions.forgetUser(userId);
    this.security.record({ type: 'password_reset', severity: 'warning', actorUserId: actor.userId, targetUserId: userId, ...meta });
    return { temporaryPassword };
  }

  // ---------------- anti-escalation ----------------
  private async assertCanGrant(actor: AuthUser, roles: string[], meta: RequestMeta) {
    const unique = [...new Set(roles)];
    const existing = await this.repo.findExistingRoles(unique);
    const unknown = unique.filter((r) => !existing.includes(r));
    if (unknown.length) throw badRequest(`Unknown role(s): ${unknown.join(', ')}`);
    if (isSuperAdmin(actor)) return;

    const granted = await this.repo.permissionsOfRoles(unique);
    const missing = granted.filter((p) => !actor.permissions.includes(p));
    if (unique.includes(SUPER_ADMIN) || missing.length) {
      this.security.record({ type: 'privilege_escalation_blocked', severity: 'critical', actorUserId: actor.userId, ...meta, details: { action: 'grant', roles: unique, missing } });
      throw forbidden(unique.includes(SUPER_ADMIN) ? 'Only a super admin can assign the super_admin role' : `You cannot grant permissions you do not have: ${missing.join(', ')}`);
    }
  }

  private async assertCanManage(actor: AuthUser, targetUserId: number, action: string, meta: RequestMeta) {
    if (!(await this.repo.findUserById(targetUserId))) throw notFound('User');
    if (isSuperAdmin(actor)) return;
    const target = await this.repo.getRolesAndPermissions(targetUserId);
    const beyond = target.permissions.filter((p) => !actor.permissions.includes(p));
    if (target.roles.includes(SUPER_ADMIN) || beyond.length) {
      this.security.record({ type: 'privilege_escalation_blocked', severity: 'critical', actorUserId: actor.userId, targetUserId, ...meta, details: { action, targetRoles: target.roles } });
      throw forbidden('You cannot manage an account with more privileges than your own');
    }
  }
}
