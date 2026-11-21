import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { EnrollmentController } from './api/enrollment.controller.js';
import { enrollmentRouter } from './api/enrollment.routes.js';
import type { AcademicLookup, StudentLookup } from './business/enrollment.ports.js';
import { EnrollmentService } from './business/enrollment.service.js';
import { PgEnrollmentRepository } from './data/enrollment.repository.js';

/** ENROLLMENT MODULE — links students to sections per academic year. */
export function createEnrollmentModule(deps: CoreDeps & { academic: AcademicLookup; students: StudentLookup }) {
  const repo = new PgEnrollmentRepository(deps.db);
  const service = new EnrollmentService(repo, deps.db, deps.academic, deps.students);

  const module: ModuleRoutes = {
    routes: [{ path: '/enrollments', router: enrollmentRouter(new EnrollmentController(service), deps.guards) }],
  };

  return {
    ...module,
    /** Read-only port used by attendance, exams and fees. */
    lookup: {
      getEnrollment: (id: number) => repo.findById(id),
      listActiveBySection: (sectionId: number) => repo.listActiveBySection(sectionId),
    },
  };
}
