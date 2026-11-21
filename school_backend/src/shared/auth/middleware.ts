import type { Request, RequestHandler } from 'express';
import { forbidden, unauthorized } from '../errors.js';
import { type AccessTokenVerifier, type AuthUser, type SessionChecker, hasAnyPermission } from './types.js';

export interface AuthGuards {
  /** Valid access token required; blocked while the user must change their password. */
  requireAuth: RequestHandler;
  /** Valid access token required; allowed even when a password change is pending. */
  requireAuthAllowPasswordChange: RequestHandler;
}

/**
 * @param verifier      checks the JWT signature / expiry (no I/O)
 * @param sessionCheck  checks the token's session is still alive, so a revoked login
 *                      (logout, password reset, role change, deactivation, stolen-token
 *                      detection) stops working within seconds instead of at token expiry.
 */
export function createAuthGuards(verifier: AccessTokenVerifier, sessionCheck: SessionChecker): AuthGuards {
  const authenticate = async (req: Request, allowPendingPasswordChange: boolean) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw unauthorized('Missing access token');
    const user = verifier.verifyAccessToken(header.slice(7).trim());
    if (!user.sessionId || !(await sessionCheck(user.sessionId, user.userId))) {
      throw unauthorized('Session has ended — please sign in again');
    }
    if (user.mustChangePassword && !allowPendingPasswordChange) {
      throw forbidden('You must change your password before continuing', 'PASSWORD_CHANGE_REQUIRED');
    }
    req.auth = user;
  };
  return {
    requireAuth: async (req, _res, next) => {
      await authenticate(req, false);
      next();
    },
    requireAuthAllowPasswordChange: async (req, _res, next) => {
      await authenticate(req, true);
      next();
    },
  };
}

/** Route guard: the user needs AT LEAST ONE of the listed permissions. */
export const requirePermission =
  (...codes: string[]): RequestHandler =>
  (req, _res, next) => {
    const user = req.auth;
    if (!user) throw unauthorized();
    if (!hasAnyPermission(user, codes)) throw forbidden();
    next();
  };

/** Controller helper: get the authenticated user or fail. */
export function getAuth(req: Request): AuthUser {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
