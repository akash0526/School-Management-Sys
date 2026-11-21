import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { SchoolController } from './api/school.controller.js';
import { schoolRouter } from './api/school.routes.js';
import { SchoolService } from './business/school.service.js';
import { PgSchoolRepository } from './data/school.repository.js';

/** SCHOOL MODULE — the school's identity (name, address, PAN, logo) for branding, receipts and report cards. */
export function createSchoolModule(deps: CoreDeps): ModuleRoutes {
  const service = new SchoolService(new PgSchoolRepository(deps.db), deps.db);
  return { routes: [{ path: '/school', router: schoolRouter(new SchoolController(service), deps.guards) }] };
}
