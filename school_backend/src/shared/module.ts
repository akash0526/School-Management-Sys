import type { RequestHandler, Router } from 'express';
import type { Logger } from 'pino';
import type { AuthGuards } from './auth/middleware.js';
import type { Database } from './db/database.js';
import type { EventBus } from './events/eventBus.js';
import type { SecurityLog } from './security/securityLog.js';
import type { Env } from '../config/env.js';

/** Infrastructure every module may receive. Modules get NOTHING else implicitly. */
export interface CoreDeps {
  db: Database;
  env: Env;
  logger: Logger;
  events: EventBus;
  guards: AuthGuards;
  /** Append-only security event log (logins, lockouts, role changes, API-key misuse). */
  security: SecurityLog;
}

/** What a module gives back to the composition root (src/container.ts). */
export interface ModuleRoutes {
  /** Mounted under /api/v1 */
  routes: Array<{ path: string; router: Router; middleware?: RequestHandler[] }>;
}
