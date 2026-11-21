import { Router } from 'express';
import { type AuthGuards, requirePermission } from '../../../shared/auth/middleware.js';
import type { AcademicController } from './academic.controller.js';

/** Reading the academic structure needs only a login; changing it needs academic.manage. */
export function academicRouter(c: AcademicController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth);
  const manage = requirePermission('academic.manage');

  r.get('/years', c.listYears);
  r.post('/years', manage, c.createYear);
  r.post('/years/:id/set-current', manage, c.setCurrentYear);
  r.get('/years/:id/terms', c.listTerms);
  r.post('/years/:id/terms', manage, c.createTerm);

  r.get('/classes', c.listClasses);
  r.get('/streams', c.listStreams);
  r.get('/rooms', c.listRooms);

  r.get('/sections', c.listSections);
  r.post('/sections', manage, c.createSection);
  r.patch('/sections/:id', manage, c.updateSection);

  r.get('/subjects', c.listSubjects);
  r.post('/subjects', manage, c.createSubject);
  r.get('/class-subjects', c.listClassSubjects);
  r.post('/class-subjects', manage, c.createClassSubject);

  r.get('/teacher-assignments', c.listAssignments);
  r.post('/teacher-assignments', manage, c.createAssignment);
  r.delete('/teacher-assignments/:id', manage, c.deleteAssignment);

  r.get('/calendar', c.listCalendar);
  r.post('/calendar', manage, c.createCalendarEntry);
  return r;
}
