import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { unauthorized } from '../../../shared/errors.js';
import type { AccessTokenVerifier, AuthUser } from '../../../shared/auth/types.js';
import type { PasswordHasher } from './auth.ports.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds: number) {}
  hash(plain: string) {
    return bcrypt.hash(plain, this.rounds);
  }
  verify(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }
}

export class TokenService implements AccessTokenVerifier {
  private readonly audience = 'school-sms-api';

  constructor(
    private readonly secret: string,
    private readonly accessTtl: string,
    private readonly issuer: string,
  ) {}

  signAccessToken(user: AuthUser): string {
    const payload = {
      usr: user.username,
      rol: user.roles,
      prm: user.permissions,
      stf: user.staffId,
      stu: user.studentId,
      grd: user.guardianId,
      mcp: user.mustChangePassword,
      sid: user.sessionId,
    };
    return jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      subject: String(user.userId),
      expiresIn: this.accessTtl as jwt.SignOptions['expiresIn'],
      issuer: this.issuer,
      audience: this.audience,
    });
  }

  verifyAccessToken(token: string): AuthUser {
    try {
      // algorithms pinned — prevents "alg: none" / algorithm-confusion attacks
      const p = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: this.audience,
      }) as jwt.JwtPayload;
      return {
        userId: Number(p.sub),
        username: p.usr,
        roles: p.rol ?? [],
        permissions: p.prm ?? [],
        staffId: p.stf ?? null,
        studentId: p.stu ?? null,
        guardianId: p.grd ?? null,
        mustChangePassword: Boolean(p.mcp),
        sessionId: typeof p.sid === 'string' && UUID.test(p.sid) ? p.sid : '',
      };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw unauthorized('Access token expired');
      throw unauthorized('Invalid access token');
    }
  }

  /** Opaque random refresh token; only its SHA-256 hash is stored in the database. */
  generateRefreshToken() {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: hashToken(token) };
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Readable temporary password, e.g. "Kx7m-Pq2r-Zt9w" */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const chars: string[] = [];
  // rejection sampling: every character equally likely (b % 56 would favour the first 32)
  const limit = 256 - (256 % alphabet.length);
  while (chars.length < 12) {
    for (const b of randomBytes(16)) if (b < limit && chars.length < 12) chars.push(alphabet[b % alphabet.length]);
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/**
 * Locks an account for 15 minutes after 5 failed logins (brute-force protection).
 * In-memory: replace with a Redis implementation when running multiple instances.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; lockedUntil: number; firstAt: number }>();
  constructor(
    private readonly maxAttempts = 5,
    private readonly lockMs = 15 * 60_000,
    private readonly maxEntries = 50_000,
  ) {}

  isLocked(username: string) {
    const f = this.failures.get(username.toLowerCase());
    return !!f && f.lockedUntil > Date.now();
  }
  recordFailure(username: string) {
    const key = username.toLowerCase();
    const now = Date.now();
    if (this.failures.size >= this.maxEntries && !this.failures.has(key)) this.prune(now);
    const f = this.failures.get(key);
    const entry = !f || now - f.firstAt > this.lockMs ? { count: 0, lockedUntil: 0, firstAt: now } : f;
    entry.count += 1;
    if (entry.count >= this.maxAttempts) entry.lockedUntil = now + this.lockMs;
    this.failures.set(key, entry);
  }
  recordSuccess(username: string) {
    this.failures.delete(username.toLowerCase());
  }
  /** Bounded memory: drop finished windows first, then the oldest entries — never wipe active lockouts wholesale. */
  private prune(now: number) {
    for (const [k, f] of this.failures) if (f.lockedUntil <= now && now - f.firstAt > this.lockMs) this.failures.delete(k);
    for (const k of this.failures.keys()) {
      if (this.failures.size < this.maxEntries * 0.9) break;
      const f = this.failures.get(k)!;
      if (f.lockedUntil <= now) this.failures.delete(k); // keep currently-locked accounts locked
    }
  }
}

/**
 * Validates that an access token's login session is still alive.
 * Results are cached briefly (default 15 s) so the database is not hit on every request;
 * revocations made by THIS process take effect immediately (cache entries are dropped).
 * With several instances, a revocation made elsewhere takes effect within the TTL.
 */
export class SessionGate {
  private readonly cache = new Map<string, { userId: number; ok: boolean; until: number }>();
  constructor(
    private readonly lookup: (sessionId: string, userId: number) => Promise<boolean>,
    private readonly ttlMs = 15_000,
  ) {}

  check = async (sessionId: string, userId: number): Promise<boolean> => {
    const now = Date.now();
    const hit = this.cache.get(sessionId);
    if (hit && hit.until > now) return hit.ok && hit.userId === userId;
    const ok = await this.lookup(sessionId, userId);
    if (this.cache.size > 20_000) this.cache.clear();
    this.cache.set(sessionId, { userId, ok, until: now + this.ttlMs });
    return ok;
  };

  forgetSession(sessionId: string) {
    this.cache.delete(sessionId);
  }

  forgetUser(userId: number) {
    for (const [sid, v] of this.cache) if (v.userId === userId) this.cache.delete(sid);
  }
}
