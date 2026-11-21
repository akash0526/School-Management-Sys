import { Router } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import type { AuthGuards } from '../../../shared/auth/middleware.js';
import { requirePermission } from '../../../shared/auth/middleware.js';
import { limiter, requireTrustedOrigin } from '../../../shared/http/middleware.js';
import type { AuthController, UsersController } from './auth.controller.js';

export function authRouter(c: AuthController, guards: AuthGuards, trustedOrigins: string[]) {
  const r = Router();
  // 10 login attempts per 15 min per IP+username, 30 per IP overall
  const perUser = limiter({
    windowMinutes: 15,
    max: 10,
    keyPrefix: 'login',
    key: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.username ?? '').trim().toLowerCase().slice(0, 50)}`,
  });
  const perIp = limiter({ windowMinutes: 15, max: 30, keyPrefix: 'login-ip' });
  const refreshLimit = limiter({ windowMinutes: 15, max: 60, keyPrefix: 'refresh' });

  r.post('/login', perIp, perUser, c.login);
  const sameOrigin = requireTrustedOrigin(trustedOrigins); // cookie-authenticated endpoints
  const pwChangeLimit = limiter({ windowMinutes: 15, max: 10, keyPrefix: 'pwchange', key: (req) => String(req.auth?.userId ?? req.ip) });

  r.post('/refresh', sameOrigin, refreshLimit, c.refresh);
  r.post('/logout', sameOrigin, c.logout);
  r.get('/me', guards.requireAuthAllowPasswordChange, c.me);
  r.post('/change-password', guards.requireAuthAllowPasswordChange, pwChangeLimit, c.changePassword);
  return r;
}

export function usersRouter(c: UsersController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth, requirePermission('users.manage'));
  r.get('/', c.list);
  r.get('/roles', c.roles);
  r.get('/security-events', c.securityEvents);
  r.post('/', c.create);
  r.patch('/:id', c.update);
  r.put('/:id/roles', c.setRoles);
  r.post('/:id/reset-password', c.resetPassword);
  return r;
}
