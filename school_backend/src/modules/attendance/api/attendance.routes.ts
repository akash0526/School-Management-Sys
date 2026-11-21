import { Router } from 'express';
import { type AuthGuards, requirePermission } from '../../../shared/auth/middleware.js';
import type { AttendanceController } from './attendance.controller.js';

export function attendanceRouter(c: AttendanceController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth);
  // section-level checks (teacher assigned?) happen in the business layer
  r.put('/sections/:sectionId', requirePermission('attendance.mark', 'attendance.mark_any'), c.markSection);
  r.get('/sections/:sectionId', requirePermission('attendance.view', 'attendance.mark', 'attendance.mark_any'), c.sectionRoster);
  // ownership (self / own child / staff) checked in the business layer
  r.get('/students/:studentId', c.studentRecords);
  r.get('/students/:studentId/summary', c.studentSummary);
  r.put('/staff', requirePermission('attendance.mark_any'), c.markStaff);
  r.get('/staff', requirePermission('attendance.view'), c.listStaff);
  return r;
}
