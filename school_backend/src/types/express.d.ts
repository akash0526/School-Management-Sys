import type { ApiClientIdentity, AuthUser } from '../shared/auth/types.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth */
      auth?: AuthUser;
      /** Set by the public module's API-key guard */
      apiClient?: ApiClientIdentity;
    }
  }
}

export {};
