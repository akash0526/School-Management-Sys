import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import { createAuthGuards } from './shared/auth/middleware.js';
import { createDatabase, type Database } from './shared/db/database.js';
import { createEventBus } from './shared/events/eventBus.js';
import { createSecurityLog } from './shared/security/securityLog.js';
import type { SessionChecker } from './shared/auth/types.js';
import type { CoreDeps, ModuleRoutes } from './shared/module.js';

import { createAcademicModule } from './modules/academic/index.js';
import { createAttendanceModule } from './modules/attendance/index.js';
import { createAuthModule, createTokenService, type IdentityResolver } from './modules/auth/index.js';
import { createEnrollmentModule } from './modules/enrollment/index.js';
import { createExamsModule } from './modules/exams/index.js';
import { createFeesModule } from './modules/fees/index.js';
import { createPublicModule } from './modules/public/index.js';
import { createSchoolModule } from './modules/school/index.js';
import { createStaffModule } from './modules/staff/index.js';
import { createStudentsModule } from './modules/students/index.js';

/**
 * COMPOSITION ROOT — the ONLY place that knows how modules connect.
 *
 * Modules never import each other. Each one declares the small "ports" it needs
 * (e.g. attendance needs `academic.lookup` and `students.access`), and they are wired here.
 * To replace a module, write a new one that satisfies the same ports and change one line below.
 * To add a module (library, transport, payroll …), create its folder and register it here.
 */
export function buildContainer(env: Env, logger: Logger, db: Database = createDatabase({ url: env.DATABASE_URL, max: env.DB_POOL_MAX, ssl: env.DB_SSL, logger })) {
  const events = createEventBus(logger);
  const security = createSecurityLog(db, logger);
  const tokens = createTokenService({ env });
  // The guard needs the auth module's session check, but the auth module needs the guards — bind lazily.
  let sessionCheck: SessionChecker = async () => false; // fail closed until auth is wired
  const guards = createAuthGuards(tokens, (sid, uid) => sessionCheck(sid, uid));
  const core: CoreDeps = { db, env, logger, events, guards, security };

  // auth needs to know who a user "is" (staff/student/guardian) — resolvers are registered after those modules exist
  const identityResolvers: IdentityResolver[] = [];
  const auth = createAuthModule({ ...core, tokens, identityResolvers });
  sessionCheck = auth.isSessionActive;

  const students = createStudentsModule({ ...core, accounts: auth.accounts });
  const staff = createStaffModule({ ...core, accounts: auth.accounts });
  identityResolvers.push(students.resolveIdentity, staff.resolveIdentity);

  const academic = createAcademicModule(core);
  const enrollment = createEnrollmentModule({ ...core, academic: academic.lookup, students: students.lookup });
  const attendance = createAttendanceModule({ ...core, academic: academic.lookup, studentAccess: students.access });
  const exams = createExamsModule({ ...core, academic: academic.lookup, studentAccess: students.access });
  const fees = createFeesModule({ ...core, studentAccess: students.access });
  const publicApi = createPublicModule(core);
  const school = createSchoolModule(core);

  const modules: ModuleRoutes[] = [auth, students, staff, academic, enrollment, attendance, exams, fees, school, publicApi];

  return { core, modules, publicService: publicApi.service };
}

export type Container = ReturnType<typeof buildContainer>;
