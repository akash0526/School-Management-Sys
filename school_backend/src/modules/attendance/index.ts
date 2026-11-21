import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { AttendanceController } from './api/attendance.controller.js';
import { attendanceRouter } from './api/attendance.routes.js';
import type { AcademicLookup, StudentAccess } from './business/attendance.ports.js';
import { AttendanceService } from './business/attendance.service.js';
import { PgAttendanceRepository } from './data/attendance.repository.js';

/** ATTENDANCE MODULE — student & staff attendance. */
export function createAttendanceModule(deps: CoreDeps & { academic: AcademicLookup; studentAccess: StudentAccess }): ModuleRoutes {
  const repo = new PgAttendanceRepository(deps.db);
  const service = new AttendanceService(repo, deps.db, deps.academic, deps.studentAccess, deps.events);
  return {
    routes: [{ path: '/attendance', router: attendanceRouter(new AttendanceController(service), deps.guards) }],
  };
}
