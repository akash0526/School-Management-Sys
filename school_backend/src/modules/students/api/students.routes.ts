import { Router } from 'express';
import { type AuthGuards, requirePermission } from '../../../shared/auth/middleware.js';
import type { GuardiansController, StudentsController } from './students.controller.js';

export function studentsRouter(c: StudentsController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth);
  const view = requirePermission('students.view');
  const manage = requirePermission('students.manage');

  r.get('/', view, c.list);
  r.get('/mine', c.mine); // parent -> children, student -> self (no permission needed)
  r.post('/', manage, c.create);
  r.get('/:id', c.get); // ownership checked in business layer
  r.patch('/:id', manage, c.update);
  r.post('/:id/status', manage, c.changeStatus);
  r.post('/:id/account', manage, c.createAccount);
  r.get('/:id/guardians', c.guardiansOf); // ownership checked in business layer
  r.post('/:id/guardians', manage, c.addGuardian);
  r.delete('/:id/guardians/:guardianId', manage, c.removeGuardian);
  return r;
}

export function guardiansRouter(c: GuardiansController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth);
  r.get('/', requirePermission('students.view'), c.list);
  r.get('/:id', requirePermission('students.view'), c.get);
  r.post('/', requirePermission('students.manage'), c.create);
  r.patch('/:id', requirePermission('students.manage'), c.update);
  r.post('/:id/account', requirePermission('students.manage'), c.createAccount);
  return r;
}
