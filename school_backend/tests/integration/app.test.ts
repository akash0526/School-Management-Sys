import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { buildContainer } from '../../src/container.js';
import { createLogger } from '../../src/shared/logger.js';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { TokenService } from '../../src/modules/auth/business/security.js';

// Uses DATABASE_URL from .env (no data is written by these tests).
const env = { ...loadEnv(), CORS_ORIGINS: ['https://portal.school.edu.np'] };
const container = buildContainer(env, createLogger('silent', false));
const app = createApp(container);
afterAll(() => container.core.db.close());

/**
 * Three assertions below need a live PostgreSQL (they check /health's real DB probe and
 * look up a session that must not exist). On a machine without a database they would
 * fail for an unrelated reason, which trains people to ignore a red suite. Skip them
 * explicitly instead, so the message says what is missing.
 */
let dbUp = false;
beforeAll(async () => {
  try {
    await container.core.db.query('SELECT 1');
    dbUp = true;
  } catch {
    dbUp = false;
  }
});
const itWithDb = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!dbUp) ctx.skip();          // reported as "skipped", never as a pass
    await fn();
  });

describe('app shell', () => {
  itWithDb('GET /health reports DB status', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('sets security headers and hides the framework', async () => {
    const r = await request(app).get('/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toBeDefined();
    expect(r.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
  });

  it('CORS: allows listed origins with credentials, refuses others', async () => {
    const ok = await request(app).options('/api/v1/auth/login').set('Origin', 'https://portal.school.edu.np').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('https://portal.school.edu.np');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app).options('/api/v1/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unknown routes → JSON 404', async () => {
    const r = await request(app).get('/api/v1/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('malformed JSON → 400 INVALID_JSON', async () => {
    const r = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"username":');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_JSON');
  });

  it('oversized body → 413', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ username: 'x', password: 'y'.repeat(1_100_000) });
    expect(r.status).toBe(413);
  });

  it('validation errors list the offending fields', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ username: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.map((d: any) => d.path)).toEqual(expect.arrayContaining(['username', 'password']));
  });

  itWithDb('protected routes need a token; public routes need an API key', async () => {
    expect((await request(app).get('/api/v1/students')).status).toBe(401);
    expect((await request(app).get('/api/v1/fees/invoices')).status).toBe(401);
    expect((await request(app).get('/api/v1/public/notices')).status).toBe(401);
    expect((await request(app).get('/api/v1/public/notices').set('X-API-Key', 'sk_' + 'a'.repeat(43))).status).toBe(401);
  });

  it('errors never leak SQL or stack traces', async () => {
    const r = await request(app).get('/api/v1/students').set('Authorization', 'Bearer not-a-jwt');
    expect(JSON.stringify(r.body)).not.toMatch(/stack|SELECT|at \//);
  });
});

describe('security hardening', () => {
  const tokens = new TokenService(env.JWT_ACCESS_SECRET, env.JWT_ACCESS_TTL, env.JWT_ISSUER);
  const superAdmin = {
    userId: 2, username: 'admin', roles: ['super_admin'], permissions: ['users.manage', 'students.view'],
    staffId: null, studentId: null, guardianId: null, mustChangePassword: false,
  };

  itWithDb('a correctly signed token for a session that does not exist is rejected (logout/revocation is real)', async () => {
    const t = tokens.signAccessToken({ ...superAdmin, sessionId: randomUUID() });
    const r = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${t}`);
    expect(r.status).toBe(401);
  });

  it('tokens without a session id (pre-hardening format) are rejected', async () => {
    const legacy = jwt.sign({ sub: '2', username: 'admin', roles: ['super_admin'], perms: ['users.manage'] }, env.JWT_ACCESS_SECRET, { expiresIn: '5m' });
    expect((await request(app).get('/api/v1/users').set('Authorization', `Bearer ${legacy}`)).status).toBe(401);
  });

  it('alg=none and wrong-secret tokens are rejected', async () => {
    const none = jwt.sign({ sub: '2', sid: randomUUID() }, '', { algorithm: 'none' as any });
    const forged = jwt.sign({ sub: '2', sid: randomUUID() }, 'x'.repeat(40), { expiresIn: '5m' });
    for (const t of [none, forged]) expect((await request(app).get('/api/v1/students').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('refresh/logout refuse cross-site origins (CSRF on the refresh cookie)', async () => {
    for (const path of ['/api/v1/auth/refresh', '/api/v1/auth/logout']) {
      const r = await request(app).post(path).set('Origin', 'https://evil.example').set('Cookie', 'refresh_token=abc');
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    }
  });

  it('JSON bodies with huge arrays are refused before validation (zod DoS defence)', async () => {
    const r = await request(app).post('/api/v1/attendance/sessions').set('Content-Type', 'application/json').send(JSON.stringify({ entries: Array(5000).fill(1) }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_JSON');
  });

  it('API responses are not cacheable and are locked down by CSP', async () => {
    const r = await request(app).get('/api/v1/students');
    expect(r.headers['cache-control']).toContain('no-store');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

