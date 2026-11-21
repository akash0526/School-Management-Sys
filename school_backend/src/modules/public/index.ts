import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { PublicController } from './api/public.controller.js';
import { publicRouter } from './api/public.routes.js';
import { PublicService } from './business/public.service.js';
import { PgPublicRepository } from './data/public.repository.js';

/**
 * PUBLIC WEBSITE API MODULE — the only door between the website and the SMS.
 * The website has its own database; it calls these endpoints server-to-server.
 */
export function createPublicModule(deps: CoreDeps): ModuleRoutes & { service: PublicService } {
  const service = new PublicService(new PgPublicRepository(deps.db), deps.db, deps.events, deps.security);
  return { routes: [{ path: '/public', router: publicRouter(new PublicController(service)) }], service };
}
