import type { Tx } from '../../../shared/db/database.js';
import type { AuthUser } from '../../../shared/auth/types.js';

/**
 * Interfaces the BUSINESS layer depends on. The DATA layer implements them.
 * Swap PostgreSQL for something else by writing a new class that implements these.
 */

export interface UserRecord {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
}

export interface SessionRecord {
  id: string;
  userId: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface UserListItem {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: string[];
}

export interface AuthRepository {
  findUserByUsername(username: string): Promise<UserRecord | null>;
  findUserById(id: number, tx?: Tx): Promise<UserRecord | null>;
  getRolesAndPermissions(userId: number): Promise<{ roles: string[]; permissions: string[] }>;
  touchLastLogin(userId: number): Promise<void>;
  createSession(
    s: { userId: number; tokenHash: string; ip: string | null; userAgent: string | null; expiresAt: Date },
    tx?: Tx,
  ): Promise<string>;
  findSessionByTokenHash(hash: string, tx?: Tx): Promise<SessionRecord | null>;
  revokeSession(id: string, tx?: Tx): Promise<void>;
  revokeAllSessions(userId: number, tx?: Tx): Promise<void>;
  updatePassword(userId: number, passwordHash: string, mustChange: boolean, tx?: Tx): Promise<void>;
  /** Session exists, belongs to the user, is not revoked/expired, and the account is active. */
  isSessionActive(sessionId: string, userId: number): Promise<boolean>;

  listUsers(opts: { search?: string; limit: number; offset: number }): Promise<{ items: UserListItem[]; total: number }>;
  createUser(
    u: { username: string; email?: string | null; phone?: string | null; passwordHash: string; mustChangePassword: boolean },
    tx?: Tx,
  ): Promise<number>;
  updateUser(id: number, patch: { email?: string | null; phone?: string | null; isActive?: boolean }, tx?: Tx): Promise<boolean>;
  replaceRoles(userId: number, roleNames: string[], tx?: Tx): Promise<void>;
  findExistingRoles(roleNames: string[]): Promise<string[]>;
  /** Union of permission codes granted by these roles. */
  permissionsOfRoles(roleNames: string[]): Promise<string[]>;
  listRoles(): Promise<unknown[]>;
  listSecurityEvents(f: { type?: string; userId?: number; severity?: string; since?: string; limit: number; offset: number }): Promise<{ items: unknown[]; total: number }>;
}

/**
 * Other modules (staff, students) tell auth "this user id belongs to staff #5".
 * The container wires these in — auth never imports another module.
 */
export type IdentityResolver = (userId: number) => Promise<Partial<Pick<AuthUser, 'staffId' | 'studentId' | 'guardianId'>>>;

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
