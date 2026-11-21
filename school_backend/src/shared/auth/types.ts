/** The authenticated user attached to every request (decoded from the access token). */
export interface AuthUser {
  userId: number;
  username: string;
  roles: string[];
  permissions: string[];
  /** Linked person records — used by ownership rules (a parent sees only their children). */
  staffId: number | null;
  studentId: number | null;
  guardianId: number | null;
  mustChangePassword: boolean;
  /** Login session this token belongs to — lets logout / deactivation / role changes revoke access tokens immediately. */
  sessionId: string;
}

/** Answers "is this login session still valid?" (not revoked, not expired, account active). Implemented by the auth module. */
export type SessionChecker = (sessionId: string, userId: number) => Promise<boolean>;

/** Implemented by the auth module; consumed by the shared middleware. */
export interface AccessTokenVerifier {
  verifyAccessToken(token: string): AuthUser;
}

/** Machine client (e.g. the public website) authenticated by API key. */
export interface ApiClientIdentity {
  id: number;
  name: string;
  scopes: string[];
}

export const hasPermission = (user: AuthUser, code: string) => user.permissions.includes(code);
export const hasAnyPermission = (user: AuthUser, codes: string[]) => codes.some((c) => user.permissions.includes(c));
