import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { AcademicController } from './api/academic.controller.js';
import { academicRouter } from './api/academic.routes.js';
import { AcademicService } from './business/academic.service.js';
import { PgAcademicRepository } from './data/academic.repository.js';

/** ACADEMIC MODULE — years, terms, classes, sections, subjects, curriculum, teacher assignments, calendar. */
export function createAcademicModule(deps: CoreDeps) {
  const repo = new PgAcademicRepository(deps.db);
  const service = new AcademicService(repo, deps.db);

  const module: ModuleRoutes = {
    routes: [{ path: '/academic', router: academicRouter(new AcademicController(service), deps.guards) }],
  };

  return {
    ...module,
    /** Read-only port used by enrollment, attendance and exams. */
    lookup: {
      getSection: (id: number) => repo.getSection(id),
      getClassSubject: (id: number) => repo.getClassSubject(id),
      getCurrentYearId: () => repo.getCurrentYearId(),
      isTeacherAssigned: (staffId: number, sectionId: number, classSubjectId?: number) =>
        repo.isTeacherAssigned(staffId, sectionId, classSubjectId),
      isClassTeacher: (staffId: number, sectionId: number) => repo.isClassTeacher(staffId, sectionId),
      isHoliday: (date: string) => repo.isHoliday(date),
    },
  };
}
