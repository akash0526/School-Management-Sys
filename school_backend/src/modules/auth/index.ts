import type { CoreDeps, ModuleRoutes } from '../../shared/module.js';
import { AuthController, UsersController } from './api/auth.controller.js';
import { authRouter, usersRouter } from './api/auth.routes.js';
import type { IdentityResolver } from './business/auth.ports.js';
import { AuthService } from './business/auth.service.js';
import { BcryptPasswordHasher, LoginThrottle, SessionGate, TokenService } from './business/security.js';
import { UsersService } from './business/users.service.js';
import { PgAuthRepository } from './data/auth.repository.js';

/**
 * AUTH MODULE — public surface.
 * Everything else in this folder is private to the module.
 */
export function createTokenService(deps: Pick<CoreDeps, 'env'>) {
  return new TokenService(deps.env.JWT_ACCESS_SECRET, deps.env.JWT_ACCESS_TTL, deps.env.JWT_ISSUER);
}

export function createAuthModule(
  deps: CoreDeps & { tokens: TokenService; identityResolvers: IdentityResolver[] },
) {
  const repo = new PgAuthRepository(deps.db);
  const hasher = new BcryptPasswordHasher(deps.env.BCRYPT_ROUNDS);
  const sessions = new SessionGate((sid, uid) => repo.isSessionActive(sid, uid));
  const authService = new AuthService(
    repo,
    deps.db,
    hasher,
    deps.tokens,
    new LoginThrottle(),
    deps.identityResolvers,
    deps.env.REFRESH_TOKEN_TTL_DAYS,
    sessions,
    deps.security,
  );
  const usersService = new UsersService(repo, deps.db, hasher, sessions, deps.security);

  const module: ModuleRoutes = {
    routes: [
      { path: '/auth', router: authRouter(new AuthController(authService, deps.env.COOKIE_SECURE), deps.guards, deps.env.CORS_ORIGINS) },
      { path: '/users', router: usersRouter(new UsersController(usersService), deps.guards) },
    ],
  };

  return {
    ...module,
    /** Port for other modules: create login accounts (staff, guardians, students) and switch them off when people leave. */
    accounts: {
      createAccount: usersService.createAccount.bind(usersService),
      deactivateLinkedAccount: usersService.deactivateLinkedAccount.bind(usersService),
    },
    /** Used by the shared auth guard: is this access token's login session still valid? */
    isSessionActive: sessions.check,
  };
}

export type { IdentityResolver } from './business/auth.ports.js';
export type { TokenService } from './business/security.js';
