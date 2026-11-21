import { createHash, randomBytes } from 'node:crypto';
import type { ApiClientIdentity } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import type { EventBus } from '../../../shared/events/eventBus.js';
import { nullSecurityLog, type SecurityLog } from '../../../shared/security/securityLog.js';
import { badRequest, forbidden, notFound, tooManyRequests, unauthorized } from '../../../shared/errors.js';
import { type InquiryInput, PUBLIC_SCOPES, type PublicRepository } from './public.ports.js';

/** API keys are long random strings, so a fast SHA-256 is enough (unlike passwords). */
export const hashApiKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');
export const generateApiKey = () => `sk_${randomBytes(32).toString('base64url')}`;

/** Normalise "::ffff:1.2.3.4" → "1.2.3.4" so IPv4 allow-lists work behind dual-stack sockets. */
const normaliseIp = (ip: string) => ip.replace(/^::ffff:/, '');

/**
 * Brute-force guard for result lookup: symbol number + DOB is a weak secret.
 * In-memory; use Redis when running more than one instance.
 */
export class LookupThrottle {
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(private readonly maxFailures = 5, private readonly windowMs = 15 * 60_000, private readonly maxEntries = 50_000) {}
  assertAllowed(key: string) {
    const f = this.failures.get(key);
    if (f && f.until > Date.now() && f.count >= this.maxFailures) throw tooManyRequests('Too many failed lookups for this number. Try again later.');
  }
  fail(key: string) {
    const now = Date.now();
    const f = this.failures.get(key);
    if (!f || f.until <= now) {
      if (this.failures.size >= this.maxEntries) this.prune(now);
      this.failures.set(key, { count: 1, until: now + this.windowMs });
    } else f.count++;
  }
  /**
   * Bounded memory WITHOUT a reset: clearing everything would let an attacker wipe the counter
   * on the record they are guessing by flooding other symbol numbers. Expired entries go first,
   * then the oldest ones that are not currently blocking.
   */
  private prune(now: number) {
    for (const [k, f] of this.failures) if (f.until <= now) this.failures.delete(k);
    for (const [k, f] of this.failures) {
      if (this.failures.size < this.maxEntries * 0.9) break;
      if (f.count < this.maxFailures) this.failures.delete(k);
    }
  }
  succeed(key: string) {
    this.failures.delete(key);
  }
}

/** BUSINESS LAYER — what the public website may see and send. Read-only except inquiries. */
export class PublicService {
  private readonly lastTouched = new Map<number, number>();

  constructor(
    private readonly repo: PublicRepository,
    private readonly tx: TransactionRunner,
    private readonly events: EventBus,
    private readonly security: SecurityLog = nullSecurityLog,
    private readonly throttle = new LookupThrottle(),
  ) {}

  // ---------------- API key auth ----------------
  async authenticate(rawKey: string | undefined, ip: string | undefined): Promise<ApiClientIdentity> {
    if (!rawKey) throw unauthorized('Missing or invalid API key');
    const client = rawKey.length >= 20 && rawKey.length <= 200 ? await this.repo.findClientByKeyHash(hashApiKey(rawKey)) : null;
    if (!client || !client.isActive) {
      this.security.record({
        type: 'api_key_rejected',
        ip,
        // never log the key itself — only a short fingerprint to correlate attempts
        details: { reason: !client ? 'unknown_key' : 'revoked_key', client: client?.name, fingerprint: hashApiKey(rawKey).slice(0, 12) },
      });
      throw unauthorized('Missing or invalid API key');
    }
    if (client.allowedIps?.length) {
      const allowed = client.allowedIps.map((a) => normaliseIp(a.replace(/\/32$/, '')));
      if (!ip || !allowed.includes(normaliseIp(ip))) {
        this.security.record({ type: 'api_key_ip_blocked', severity: 'critical', ip, details: { client: client.name } });
        throw forbidden('This API key is not allowed from your IP address');
      }
    }
    // update last_used_at at most once a minute per client
    const now = Date.now();
    if ((this.lastTouched.get(client.id) ?? 0) < now - 60_000) {
      this.lastTouched.set(client.id, now);
      void this.repo.touchClient(client.id).catch(() => undefined);
    }
    return { id: client.id, name: client.name, scopes: client.scopes };
  }

  async createClient(input: { name: string; scopes: string[]; allowedIps?: string[] }) {
    const bad = input.scopes.filter((s) => !(PUBLIC_SCOPES as readonly string[]).includes(s));
    if (bad.length) throw badRequest(`Unknown scopes: ${bad.join(', ')}`);
    const apiKey = generateApiKey();
    const id = await this.tx.transaction(null, (t) =>
      this.repo.createClient({ name: input.name, keyHash: hashApiKey(apiKey), scopes: input.scopes, allowedIps: input.allowedIps?.length ? input.allowedIps : null }, t),
    );
    return { id, apiKey }; // the plain key is shown ONCE and never stored
  }

  /** Disable a client immediately (e.g. key leaked or website decommissioned). */
  async revokeClient(name: string) {
    if (!(await this.tx.transaction(null, (t) => this.repo.setClientActive(name, false, t)))) throw notFound('API client');
  }

  /** Issue a new key for an existing client; the old key stops working at once. */
  async rotateClientKey(name: string) {
    const apiKey = generateApiKey();
    if (!(await this.tx.transaction(null, (t) => this.repo.rotateClientKey(name, hashApiKey(apiKey), t)))) throw notFound('API client');
    return { apiKey };
  }

  // ---------------- read endpoints ----------------
  async school() {
    const p = await this.repo.schoolProfile();
    if (!p) throw notFound('School profile');
    return p;
  }
  notices(f: { updatedSince?: string; limit: number; offset: number }) {
    return this.repo.notices(f);
  }
  async notice(id: number) {
    const n = await this.repo.notice(id);
    if (!n) throw notFound('Notice');
    return n;
  }
  events_(f: { from?: string; to?: string; limit: number; offset: number }) {
    return this.repo.events(f);
  }
  staff() {
    return this.repo.staff();
  }
  classes() {
    return this.repo.classes();
  }

  // ---------------- inquiries (website → SMS) ----------------
  /** Idempotent: re-sending the same externalRef returns the existing inquiry instead of a duplicate. */
  async createInquiry(client: ApiClientIdentity, input: InquiryInput) {
    if (input.externalRef) {
      const existing = await this.repo.findInquiryByExternalRef(input.externalRef);
      if (existing) return { id: existing, duplicate: true };
    }
    let classId = input.applyingClassId ?? null;
    if (!classId && input.applyingClassName) classId = await this.repo.classIdByName(input.applyingClassName);

    const id = await this.tx.transaction(null, (t) => this.repo.createInquiry({ ...input, applyingClassId: classId }, t));
    this.events.publish('inquiry.received', { inquiryId: id, source: client.name });
    return { id, duplicate: false };
  }

  // ---------------- result lookup ----------------
  async lookupResult(client: ApiClientIdentity, q: { symbolNo?: string; admissionNo?: string; dob: string; examId?: number }) {
    const who = (q.symbolNo ?? q.admissionNo ?? '').toUpperCase();
    const key = `${client.id}:${who}`;
    try {
      this.throttle.assertAllowed(key);
    } catch (err) {
      this.security.record({ type: 'result_lookup_throttled', details: { client: client.name, number: who } });
      throw err;
    }
    const rows = await this.repo.lookupResults(q);
    if (!rows.length) {
      this.throttle.fail(key);
      // same message whether the number or the DOB was wrong (no enumeration)
      throw notFound('Published result for these details');
    }
    this.throttle.succeed(key);
    return { results: rows };
  }
}
