import { Router } from 'express';
import { type AuthGuards, requirePermission } from '../../../shared/auth/middleware.js';
import type { EnrollmentController } from './enrollment.controller.js';

export function enrollmentRouter(c: EnrollmentController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth);
  const view = requirePermission('students.view');
  const manage = requirePermission('enrollment.manage');

  r.get('/', view, c.list);
  r.post('/', manage, c.enroll);
  r.post('/promote', manage, c.promote);
  r.post('/sections/:sectionId/assign-roll-numbers', manage, c.assignRollNumbers);
  r.get('/:id', view, c.get);
  r.patch('/:id', manage, c.update);
  r.put('/:id/subjects', manage, c.setSubjects);
  return r;
}
