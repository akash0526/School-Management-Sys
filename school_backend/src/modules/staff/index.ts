import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { StaffController } from './api/staff.controller.js';
import { staffRouter } from './api/staff.routes.js';
import type { UserAccountService } from './business/staff.ports.js';
import { StaffService } from './business/staff.service.js';
import { PgStaffRepository } from './data/staff.repository.js';

/** STAFF MODULE — staff records, departments, staff logins. */
export function createStaffModule(deps: CoreDeps & { accounts: UserAccountService }) {
  const repo = new PgStaffRepository(deps.db);
  const service = new StaffService(repo, deps.db, deps.accounts);

  const module: ModuleRoutes = {
    routes: [{ path: '/staff', router: staffRouter(new StaffController(service), deps.guards) }],
  };

  return {
    ...module,
    /** Port for auth: which staff record belongs to a user id. */
    resolveIdentity: async (userId: number) => ({ staffId: await repo.findIdByUserId(userId) }),
  };
}
