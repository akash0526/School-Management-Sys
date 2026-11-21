import { Router } from 'express';
import { type AuthGuards, requirePermission } from '../../../shared/auth/middleware.js';
import type { SchoolController } from './school.controller.js';

/** Branding and logo are public (login screen); the full profile needs a login; changes need settings.manage. */
export function schoolRouter(c: SchoolController, guards: AuthGuards) {
  const r = Router();
  r.get('/branding', c.branding);
  r.get('/logo', c.logo);

  r.use(guards.requireAuth);
  const manage = requirePermission('settings.manage');
  r.get('/profile', c.profile);
  r.put('/profile', manage, c.saveProfile);
  r.put('/logo', manage, c.setLogo);
  r.delete('/logo', manage, c.removeLogo);
  return r;
}
