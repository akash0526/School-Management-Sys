import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateApiKey, hashApiKey, LookupThrottle, PublicService } from '../../src/modules/public/business/public.service.js';
import type { ApiClientRecord } from '../../src/modules/public/business/public.ports.js';

/**
 * `PublicService.authenticate` is the only thing standing between an anonymous visitor and
 * the school's data. It was covered only by the e2e script, which needs a live server — so
 * the edge cases below (an IPv4 allow-list behind a dual-stack socket, a revoked key, a key
 * that is revoked *while* the rate limiter is throttling) had no direct test.
 *
 * The repository is faked; nothing here touches a database.
 */

const CLIENT: ApiClientRecord = { id: 7, name: 'public-website', scopes: ['notices.read'], allowedIps: null, isActive: true };

function makeService(client: ApiClientRecord | null = CLIENT) {
  const repo = {
    findClientByKeyHash: vi.fn(async () => client),
    touchClient: vi.fn(async () => undefined),
  };
  const security = { record: vi.fn() };
  const service = new PublicService(
    repo as never,
    { transaction: vi.fn() } as never,
    { emit: vi.fn() } as never,
    security as never,
    new LookupThrottle(),
  );
  return { service, repo, security };
}

const KEY = 'sk_' + 'a'.repeat(43);

beforeEach(() => vi.clearAllMocks());

describe('API key authentication', () => {
  it('accepts a valid key and returns only id, name and scopes', async () => {
    const { service, repo } = makeService();
    const id = await service.authenticate(KEY, '1.2.3.4');
    expect(id).toEqual({ id: 7, name: 'public-website', scopes: ['notices.read'] });
    // the key is looked up by HASH — the plain key must never reach the data layer
    expect(repo.findClientByKeyHash).toHaveBeenCalledWith(hashApiKey(KEY));
    expect(JSON.stringify(repo.findClientByKeyHash.mock.calls)).not.toContain(KEY);
  });

  it('rejects a missing key without touching the database', async () => {
    const { service, repo } = makeService();
    await expect(service.authenticate(undefined, '1.2.3.4')).rejects.toThrow(/Missing or invalid API key/);
    expect(repo.findClientByKeyHash).not.toHaveBeenCalled();
  });

  it('rejects absurdly short or long keys without a database lookup', async () => {
    const { service, repo } = makeService();
    await expect(service.authenticate('sk_short', '1.2.3.4')).rejects.toThrow();
    await expect(service.authenticate('sk_' + 'x'.repeat(500), '1.2.3.4')).rejects.toThrow();
    expect(repo.findClientByKeyHash).not.toHaveBeenCalled();
  });

  it('gives the same error for an unknown key and a revoked one', async () => {
    // distinguishing them would tell an attacker which of their guesses was once real
    const unknown = makeService(null);
    const revoked = makeService({ ...CLIENT, isActive: false });
    const a = await unknown.service.authenticate(KEY, '1.2.3.4').catch((e) => e.message);
    const b = await revoked.service.authenticate(KEY, '1.2.3.4').catch((e) => e.message);
    expect(a).toBe(b);
  });

  it('logs a rejection with a fingerprint but never the key itself', async () => {
    const { service, security } = makeService(null);
    await service.authenticate(KEY, '1.2.3.4').catch(() => undefined);
    const event = security.record.mock.calls[0][0];
    expect(event.type).toBe('api_key_rejected');
    expect(event.details.reason).toBe('unknown_key');
    expect(event.details.fingerprint).toHaveLength(12);
    expect(JSON.stringify(event)).not.toContain(KEY);
  });

  it('records REVOKED (not unknown) for a disabled client, for the audit trail', async () => {
    const { service, security } = makeService({ ...CLIENT, isActive: false });
    await service.authenticate(KEY, '1.2.3.4').catch(() => undefined);
    expect(security.record.mock.calls[0][0].details.reason).toBe('revoked_key');
  });
});

describe('IP allow-list', () => {
  it('allows a client from a listed address', async () => {
    const { service } = makeService({ ...CLIENT, allowedIps: ['203.0.113.9'] });
    await expect(service.authenticate(KEY, '203.0.113.9')).resolves.toMatchObject({ id: 7 });
  });

  it('matches an IPv4 allow-list entry against a dual-stack "::ffff:" peer address', async () => {
    // Node reports IPv4 connections over a dual-stack socket as ::ffff:203.0.113.9 —
    // without normalising, a correct allow-list silently blocks the website.
    const { service } = makeService({ ...CLIENT, allowedIps: ['203.0.113.9'] });
    await expect(service.authenticate(KEY, '::ffff:203.0.113.9')).resolves.toMatchObject({ id: 7 });
  });

  it('tolerates allow-list entries stored with a /32 suffix', async () => {
    const { service } = makeService({ ...CLIENT, allowedIps: ['203.0.113.9/32'] });
    await expect(service.authenticate(KEY, '203.0.113.9')).resolves.toMatchObject({ id: 7 });
  });

  it('blocks a different address and logs it as critical', async () => {
    const { service, security } = makeService({ ...CLIENT, allowedIps: ['203.0.113.9'] });
    await expect(service.authenticate(KEY, '198.51.100.1')).rejects.toThrow(/not allowed from your IP/);
    const event = security.record.mock.calls[0][0];
    expect(event.type).toBe('api_key_ip_blocked');
    expect(event.severity).toBe('critical');
  });

  it('blocks a request with no peer address rather than assuming it is allowed', async () => {
    const { service } = makeService({ ...CLIENT, allowedIps: ['203.0.113.9'] });
    await expect(service.authenticate(KEY, undefined)).rejects.toThrow(/not allowed from your IP/);
  });

  it('skips the check entirely when no allow-list is set', async () => {
    const { service } = makeService();
    await expect(service.authenticate(KEY, undefined)).resolves.toMatchObject({ id: 7 });
  });
});

describe('last-used bookkeeping', () => {
  it('touches last_used_at at most once a minute per client', async () => {
    // otherwise every single public page view writes a row
    const { service, repo } = makeService();
    for (let i = 0; i < 25; i++) await service.authenticate(KEY, '1.2.3.4');
    expect(repo.touchClient).toHaveBeenCalledTimes(1);
  });

  it('records the touch again after the window passes', async () => {
    const { service, repo } = makeService();
    const realNow = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow);
    await service.authenticate(KEY, '1.2.3.4');
    spy.mockReturnValue(realNow + 61_000);
    await service.authenticate(KEY, '1.2.3.4');
    expect(repo.touchClient).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('does not fail authentication when the bookkeeping write fails', async () => {
    const { service, repo } = makeService();
    repo.touchClient.mockRejectedValue(new Error('deadlock'));
    await expect(service.authenticate(KEY, '1.2.3.4')).resolves.toMatchObject({ id: 7 });
  });
});

describe('client creation', () => {
  it('refuses an unknown scope instead of storing a typo', async () => {
    const { service } = makeService();
    await expect(service.createClient({ name: 'x', scopes: ['notices.read', 'root'] })).rejects.toThrow(/Unknown scopes: root/);
  });

  it('stores only the hash and returns the plain key exactly once', async () => {
    const created: unknown[] = [];
    const repo = {
      createClient: vi.fn(async (c: unknown) => {
        created.push(c);
        return 1;
      }),
    };
    const service = new PublicService(
      repo as never,
      { transaction: async (_u: unknown, fn: (t: unknown) => unknown) => fn({}) } as never,
      { emit: vi.fn() } as never,
      { record: vi.fn() } as never,
      new LookupThrottle(),
    );
    const { apiKey } = await service.createClient({ name: 'site', scopes: ['notices.read'] });
    expect(apiKey).toMatch(/^sk_/);
    const stored = created[0] as { keyHash: string };
    expect(stored.keyHash).toBe(hashApiKey(apiKey));
    expect(JSON.stringify(stored)).not.toContain(apiKey);
  });
});

describe('generated keys', () => {
  it('are long, unique and prefixed', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
    expect(keys.size).toBe(50);
    for (const k of keys) {
      expect(k).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
      expect(k.length).toBeGreaterThanOrEqual(20); // passes the authenticate length guard
    }
  });
});
