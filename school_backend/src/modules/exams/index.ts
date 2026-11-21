import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { ExamsController } from './api/exams.controller.js';
import { examsRouter } from './api/exams.routes.js';
import type { AcademicLookup, StudentAccess } from './business/exams.ports.js';
import { ExamsService } from './business/exams.service.js';
import { PgExamsRepository } from './data/exams.repository.js';

/** EXAMS MODULE — exams, papers & components, marks, NEB result processing, report cards. */
export function createExamsModule(deps: CoreDeps & { academic: AcademicLookup; studentAccess: StudentAccess }): ModuleRoutes {
  const repo = new PgExamsRepository(deps.db);
  const service = new ExamsService(repo, deps.db, deps.academic, deps.studentAccess, deps.events);
  return { routes: [{ path: '/exams', router: examsRouter(new ExamsController(service), deps.guards) }] };
}
