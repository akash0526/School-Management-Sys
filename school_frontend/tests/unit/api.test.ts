import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, get, qs, refreshAccessToken, setAuthHandlers, tokenStore } from '../../src/lib/api.js';

/**
 * `api()` is the single door between the UI and the server, and it has branches that only
 * fire at the worst moments: the access token expired mid-session. A mistake here either
 * logs the user out while they were fine, or keeps retrying with a dead token.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const noContent = () => new Response(null, { status: 204 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  tokenStore.set('token-1');
  setAuthHandlers({ onAuthLost: vi.fn(), onPasswordChangeRequired: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  tokenStore.set(null);
});

describe('qs', () => {
  it('drops undefined, null and empty-string filters', () => {
    // a blank select must not send `status=` and filter everything out
    expect(qs({ status: undefined, classId: null, q: '', page: 1 })).toBe('?page=1');
  });

  it('returns an empty string when nothing is left, so the URL has no stray "?"', () => {
    expect(qs({})).toBe('');
    expect(qs(undefined)).toBe('');
    expect(qs({ a: undefined })).toBe('');
  });

  it('encodes values that would otherwise break the query', () => {
    expect(qs({ q: 'Sita & Sons' })).toBe('?q=Sita+%26+Sons');
  });

  it('keeps false and 0 — they are real filter values', () => {
    expect(qs({ active: false, page: 0 })).toBe('?active=false&page=0');
  });
});

describe('api — request shape', () => {
  it('sends the access token and JSON body', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await api('/students', { method: 'POST', body: { firstName: 'Sita' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/students');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"firstName":"Sita"}');
    // the refresh cookie must travel with every call
    expect(init.credentials).toBe('same-origin');
  });

  it('sends no Content-Type on a GET, and no Authorization when signed out', async () => {
    tokenStore.set(null);
    fetchMock.mockResolvedValue(json([]));
    await get('/public/notices', { limit: 5 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/public/notices?limit=5');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('returns undefined for 204 without trying to parse a body', async () => {
    fetchMock.mockResolvedValue(noContent());
    await expect(api('/fees/receipts/1/cancel', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('api — errors', () => {
  it('maps a network failure to a status-0 error with a human message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await api('/students').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK');
    expect(err.message).toMatch(/Cannot reach the server/);
  });

  it('surfaces the server error code and message', async () => {
    // the login path has its own 401 handling, so it is excluded from the refresh branch
    fetchMock.mockResolvedValue(json({ error: { code: 'INVALID_CREDENTIALS', message: 'Wrong username or password' } }, 401));
    const err = (await api('/auth/login', { method: 'POST', body: {} }).catch((e) => e)) as ApiError;
    expect(err.code).toBe('INVALID_CREDENTIALS');
    expect(err.message).toBe('Wrong username or password');
  });

  it('replaces a 5xx body with a message that does not leak internals', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'INTERNAL' } }, 500));
    const err = (await api('/students').catch((e) => e)) as ApiError;
    expect(err.message).toMatch(/Something went wrong on the server/);
  });

  it('turns a 429 into advice the user can act on', async () => {
    fetchMock.mockResolvedValue(json({}, 429));
    const err = (await api('/auth/login', { method: 'POST' }).catch((e) => e)) as ApiError;
    expect(err.message).toMatch(/Too many attempts/);
  });

  it('tolerates a non-JSON error body instead of throwing a parse error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const err = (await api('/students').catch((e) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.code).toBe('HTTP_502');
  });

  it('exposes zod field errors as a field → message map for forms', () => {
    const err = new ApiError(400, 'VALIDATION', 'Invalid input', [
      { path: 'firstName', message: 'Required' },
      { path: 'dob', message: 'Must be in the past' },
      { path: 'firstName', message: 'duplicate — first wins' },
    ]);
    expect(err.fieldErrors).toEqual({ firstName: 'Required', dob: 'Must be in the past' });
    expect(new ApiError(400, 'X', 'no details').fieldErrors).toEqual({});
  });
});

describe('api — the 401 refresh-and-retry path', () => {
  it('refreshes once and replays the request with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: 'EXPIRED' } }, 401)) // first attempt
      .mockResolvedValueOnce(json({ accessToken: 'token-2' })) //   /auth/refresh
      .mockResolvedValueOnce(json({ items: [] })); //               replayed request

    await expect(get('/students')).resolves.toEqual({ items: [] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer token-2');
    expect(tokenStore.get()).toBe('token-2');
  });

  it('does not loop forever when the replay is rejected too', async () => {
    // a dead refresh cookie must end the session, not retry in circles
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ accessToken: 'token-2' }))
      .mockResolvedValueOnce(json({ error: { code: 'EXPIRED' } }, 401));

    const err = (await api('/students').catch((e) => e)) as ApiError;
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3); // attempt, refresh, one replay — then stop
  });

  it('signs the user out when the refresh itself fails', async () => {
    const onAuthLost = vi.fn();
    setAuthHandlers({ onAuthLost, onPasswordChangeRequired: vi.fn() });
    fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(new Response(null, { status: 401 }));

    const err = (await api('/students').catch((e) => e)) as ApiError;
    expect(err.status).toBe(401);
    expect(onAuthLost).toHaveBeenCalledOnce();
    expect(tokenStore.get()).toBeNull(); // a dead token must not linger
  });

  it('does not try to refresh a failed login (the user simply typed it wrong)', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'INVALID_CREDENTIALS', message: 'Wrong' } }, 401));
    await api('/auth/login', { method: 'POST', body: { username: 'a', password: 'b' } }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares ONE refresh between concurrent 401s (two tabs must not burn a rotating token twice)', async () => {
    let resolveRefresh!: (r: Response) => void;
    const pendingRefresh = new Promise<Response>((res) => (resolveRefresh = res));

    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/v1/auth/refresh') return pendingRefresh;
      // first call for each path gets a 401; the replay succeeds
      return Promise.resolve(url.includes('replay') ? json({ ok: true }) : json({}, 401));
    });
    // simpler: two different paths, each 401 then ok after refresh
    let n = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/v1/auth/refresh') return pendingRefresh;
      n += 1;
      return Promise.resolve(n <= 2 ? json({}, 401) : json({ ok: url }));
    });

    const both = Promise.all([api('/a'), api('/b')]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3)); // 2 attempts + 1 refresh
    resolveRefresh(json({ accessToken: 'token-3' }));
    const [a, b] = await both;

    expect(a).toEqual({ ok: '/api/v1/a' });
    expect(b).toEqual({ ok: '/api/v1/b' });
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/v1/auth/refresh')).toHaveLength(1);
  });
});

describe('refreshAccessToken', () => {
  it('returns false when the server refuses, and does not install a new token', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(refreshAccessToken()).resolves.toBe(false);
    // refresh only ever ADDS a token; clearing the dead one is the caller's job (api() does it),
    // so a failed background refresh does not sign out a session that is mid-request
    expect(tokenStore.get()).toBe('token-1');
  });

  it('returns false on a network error instead of throwing', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(refreshAccessToken()).resolves.toBe(false);
  });

  it('only fetches once while a refresh is in flight', async () => {
    fetchMock.mockResolvedValue(json({ accessToken: 'token-9' }));
    await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokenStore.get()).toBe('token-9');
  });
});
