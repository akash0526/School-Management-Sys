import { Router } from 'express';
import { type AuthGuards, requirePermission } from '../../../shared/auth/middleware.js';
import type { StaffController } from './staff.controller.js';

export function staffRouter(c: StaffController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth);
  r.get('/', requirePermission('staff.view'), c.list);
  r.get('/me', c.me);
  r.get('/departments', requirePermission('staff.view'), c.listDepartments);
  r.post('/departments', requirePermission('staff.manage'), c.createDepartment);
  r.post('/', requirePermission('staff.manage'), c.create);
  r.get('/:id', c.get); // self or staff.view — checked in business layer
  r.patch('/:id', requirePermission('staff.manage'), c.update);
  r.post('/:id/account', requirePermission('staff.manage'), c.createAccount);
  return r;
}
