import type { TransactionRunner } from '../../../shared/db/database.js';
import type { AuthUser } from '../../../shared/auth/types.js';
import { AppError, badRequest, unauthorized } from '../../../shared/errors.js';
import type { SecurityLog } from '../../../shared/security/securityLog.js';
import type { AuthRepository, IdentityResolver, PasswordHasher, RequestMeta, UserRecord } from './auth.ports.js';
import { assertStrongPassword } from './passwordPolicy.js';
import { hashToken, LoginThrottle, SessionGate, TokenService } from './security.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUser;
}

/** BUSINESS LAYER — login, token rotation, logout, password change. No HTTP, no SQL. */
export class AuthService {
  // Used to make "unknown user" take as long as "wrong password" (prevents username enumeration by timing)
  private dummyHash: Promise<string>;

  constructor(
    private readonly repo: AuthRepository,
    private readonly tx: TransactionRunner,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly throttle: LoginThrottle,
    private readonly identityResolvers: IdentityResolver[],
    private readonly refreshTtlDays: number,
    private readonly sessions: SessionGate,
    private readonly security: SecurityLog,
    /** Separate throttle for wrong "current password" on change-password (stolen access token brute force). */
    private readonly passwordChangeThrottle = new LoginThrottle(5, 15 * 60_000),
  ) {
    this.dummyHash = hasher.hash('dummy-password-for-timing');
  }

  async login(username: string, password: string, meta: RequestMeta): Promise<TokenPair> {
    if (this.throttle.isLocked(username)) {
      this.security.record({ type: 'account_locked', severity: 'warning', username, ...meta, details: { reason: 'attempt while locked' } });
      throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 15 minutes.');
    }
    const user = await this.repo.findUserByUsername(username);
    const ok = await this.hasher.verify(password, user?.passwordHash ?? (await this.dummyHash));

    if (!user || !ok || !user.isActive) {
      this.throttle.recordFailure(username);
      const reason = !user ? 'unknown_user' : !ok ? 'wrong_password' : 'inactive_account';
      this.security.record({ type: 'login_failed', username, targetUserId: user?.id ?? null, ...meta, details: { reason } });
      if (this.throttle.isLocked(username)) {
        this.security.record({ type: 'account_locked', severity: 'critical', username, targetUserId: user?.id ?? null, ...meta, details: { minutes: 15 } });
      }
      throw unauthorized('Invalid username or password'); // same message for every case
    }
    this.throttle.recordSuccess(username);
    await this.repo.touchLastLogin(user.id);
    const pair = await this.issueTokens(user, meta);
    this.security.record({ type: 'login_success', actorUserId: user.id, targetUserId: user.id, username: user.username, ...meta });
    return pair;
  }

  /** Refresh-token rotation with reuse detection. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const hash = hashToken(refreshToken);
    // The session row is locked (FOR UPDATE), so two parallel refreshes of one token can't both succeed.
    const outcome = await this.tx.transaction(null, async (tx) => {
      const session = await this.repo.findSessionByTokenHash(hash, tx);
      if (!session) throw unauthorized('Invalid refresh token');

      if (session.revokedAt) {
        // A revoked token was presented again: it was probably stolen. Kill every session of this user.
        // NOTE: we must NOT throw inside the transaction here — that would roll the revocation back.
        await this.repo.revokeAllSessions(session.userId, tx);
        return { reuse: true as const, userId: session.userId };
      }
      if (session.expiresAt.getTime() < Date.now()) throw unauthorized('Refresh token expired');

      const user = await this.repo.findUserById(session.userId, tx);
      if (!user || !user.isActive) throw unauthorized('Account disabled');

      await this.repo.revokeSession(session.id, tx);
      return { reuse: false as const, oldSessionId: session.id, tokens: await this.issueTokens(user, meta, tx) };
    });
    if (outcome.reuse) {
      this.sessions.forgetUser(outcome.userId);
      this.security.record({ type: 'refresh_reuse', severity: 'critical', targetUserId: outcome.userId, ...meta, details: { action: 'all sessions revoked' } });
      throw unauthorized('Refresh token reuse detected — all sessions have been signed out');
    }
    this.sessions.forgetSession(outcome.oldSessionId); // after commit, so no lookup can re-cache it as active
    return outcome.tokens;
  }

  async logout(refreshToken: string | undefined, meta: RequestMeta) {
    if (!refreshToken) return;
    const session = await this.repo.findSessionByTokenHash(hashToken(refreshToken));
    if (session) {
      await this.repo.revokeSession(session.id);
      this.sessions.forgetSession(session.id);
      this.security.record({ type: 'logout', actorUserId: session.userId, targetUserId: session.userId, ...meta });
    }
  }

  async changePassword(auth: AuthUser, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<TokenPair> {
    const key = `user:${auth.userId}`;
    if (this.passwordChangeThrottle.isLocked(key)) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong passwords. Try again in 15 minutes.');
    }
    const user = await this.repo.findUserById(auth.userId);
    if (!user) throw unauthorized();
    if (!(await this.hasher.verify(currentPassword, user.passwordHash))) {
      this.passwordChangeThrottle.recordFailure(key);
      this.security.record({ type: 'password_change_failed', actorUserId: user.id, targetUserId: user.id, username: user.username, ...meta });
      throw badRequest('Current password is incorrect');
    }
    this.passwordChangeThrottle.recordSuccess(key);
    if (currentPassword === newPassword) throw badRequest('New password must be different');
    assertStrongPassword(newPassword, { username: user.username });

    const newHash = await this.hasher.hash(newPassword);
    const pair = await this.tx.transaction(auth.userId, async (tx) => {
      await this.repo.updatePassword(user.id, newHash, false, tx);
      await this.repo.revokeAllSessions(user.id, tx); // sign out every other device
      return this.issueTokens({ ...user, mustChangePassword: false }, meta, tx);
    });
    this.sessions.forgetUser(user.id);
    this.security.record({ type: 'password_changed', actorUserId: user.id, targetUserId: user.id, username: user.username, ...meta });
    return pair;
  }

  async buildAuthUser(user: UserRecord, sessionId: string): Promise<AuthUser> {
    const { roles, permissions } = await this.repo.getRolesAndPermissions(user.id);
    const identity: AuthUser = {
      userId: user.id,
      username: user.username,
      roles,
      permissions,
      staffId: null,
      studentId: null,
      guardianId: null,
      mustChangePassword: user.mustChangePassword,
      sessionId,
    };
    for (const resolve of this.identityResolvers) Object.assign(identity, await resolve(user.id));
    return identity;
  }

  private async issueTokens(user: UserRecord, meta: RequestMeta, tx?: Parameters<AuthRepository['createSession']>[1]): Promise<TokenPair> {
    const { token, hash } = this.tokens.generateRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlDays * 86_400_000);
    const sessionId = await this.repo.createSession({ userId: user.id, tokenHash: hash, ip: meta.ip, userAgent: meta.userAgent, expiresAt: refreshExpiresAt }, tx);
    const authUser = await this.buildAuthUser(user, sessionId);
    return { accessToken: this.tokens.signAccessToken(authUser), refreshToken: token, refreshExpiresAt, user: authUser };
  }
}
