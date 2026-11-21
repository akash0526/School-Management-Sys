import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { GuardiansController, StudentsController } from './api/students.controller.js';
import { guardiansRouter, studentsRouter } from './api/students.routes.js';
import { StudentAccessPolicy } from './business/students.policy.js';
import type { UserAccountService } from './business/students.ports.js';
import { StudentsService } from './business/students.service.js';
import { PgStudentsRepository } from './data/students.repository.js';

/** STUDENTS MODULE — students, guardians, parent/student ownership rules. */
export function createStudentsModule(deps: CoreDeps & { accounts: UserAccountService }) {
  const repo = new PgStudentsRepository(deps.db);
  const policy = new StudentAccessPolicy(repo);
  const service = new StudentsService(repo, deps.db, policy, deps.accounts, deps.events);

  const module: ModuleRoutes = {
    routes: [
      { path: '/students', router: studentsRouter(new StudentsController(service), deps.guards) },
      { path: '/guardians', router: guardiansRouter(new GuardiansController(service), deps.guards) },
    ],
  };

  return {
    ...module,
    /** Port: "may this user see this student?" — used by attendance, exams, fees. */
    access: {
      canViewStudent: policy.canViewStudent.bind(policy),
      assertCanViewStudent: policy.assertCanViewStudent.bind(policy),
    },
    /** Read-only port used by enrollment. */
    lookup: {
      getStudentStatus: (studentId: number) => repo.getStatus(studentId),
    },
    /** Port for auth: which student/guardian record belongs to a user id. */
    resolveIdentity: async (userId: number) => ({
      studentId: await repo.findIdByUserId(userId),
      guardianId: await repo.findGuardianIdByUserId(userId),
    }),
  };
}
