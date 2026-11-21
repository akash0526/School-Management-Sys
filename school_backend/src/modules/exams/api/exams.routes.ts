import { Router } from 'express';
import { type AuthGuards, requirePermission } from '../../../shared/auth/middleware.js';
import type { ExamsController } from './exams.controller.js';

export function examsRouter(c: ExamsController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth);
  const manage = requirePermission('exams.manage');
  const staffView = requirePermission('exams.manage', 'marks.enter', 'marks.enter_any', 'marks.approve', 'results.view');

  r.get('/', staffView, c.list);
  r.post('/', manage, c.create);

  // marks entry (teacher/subject checks happen in the business layer)
  r.get('/components/:componentId/marks', requirePermission('marks.enter', 'marks.enter_any', 'marks.approve', 'results.view'), c.marksheet);
  r.put('/components/:componentId/marks', requirePermission('marks.enter', 'marks.enter_any'), c.enterMarks);

  // students/parents: own published exam history (checked in business layer)
  r.get('/students/:studentId/results', c.studentResults);

  r.get('/:id', staffView, c.get);
  r.patch('/:id', manage, c.update);
  r.get('/:id/schedules', staffView, c.listSchedules);
  r.post('/:id/schedules', manage, c.addSchedule);
  r.post('/:id/verify', requirePermission('marks.approve'), c.verify);
  r.post('/:id/process', requirePermission('results.process'), c.process);
  r.post('/:id/publish', requirePermission('results.publish'), c.publish);
  r.get('/:id/results', requirePermission('results.view'), c.results);
  // students/parents: own report card after publishing (checked in business layer)
  r.get('/:id/report-cards/:studentId', c.reportCard);
  return r;
}
