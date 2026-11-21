import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { FeesController } from './api/fees.controller.js';
import { feesRouter } from './api/fees.routes.js';
import type { StudentAccess } from './business/fees.ports.js';
import { FeesService } from './business/fees.service.js';
import { PgFeesRepository } from './data/fees.repository.js';

/** FEES MODULE — fee setup, invoices, receipts, discounts, student ledger. */
export function createFeesModule(deps: CoreDeps & { studentAccess: StudentAccess }): ModuleRoutes {
  const repo = new PgFeesRepository(deps.db);
  const service = new FeesService(repo, deps.db, deps.studentAccess, deps.events);
  return { routes: [{ path: '/fees', router: feesRouter(new FeesController(service), deps.guards) }] };
}
