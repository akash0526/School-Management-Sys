import { rowsToCamel, containsPattern } from '../../../shared/db/sql.js';
import type { Database, Queryable } from '../../../shared/db/database.js';
import type { AuthRepository, SessionRecord, UserListItem, UserRecord } from '../business/auth.ports.js';

/** DATA LAYER — the only place in the auth module that knows SQL / table names. */
export class PgAuthRepository implements AuthRepository {
  constructor(private readonly db: Database) {}

  async findUserByUsername(username: string): Promise<UserRecord | null> {
    const { rows } = await this.db.query(
      `SELECT id, username, email, phone, password_hash, is_active, must_change_password
         FROM users WHERE username = $1 AND deleted_at IS NULL`,
      [username],
    );
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async findUserById(id: number, q: Queryable = this.db): Promise<UserRecord | null> {
    const { rows } = await q.query(
      `SELECT id, username, email, phone, password_hash, is_active, must_change_password
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async getRolesAndPermissions(userId: number) {
    const { rows } = await this.db.query(
      `SELECT COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
              COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1`,
      [userId],
    );
    return { roles: rows[0]?.roles ?? [], permissions: rows[0]?.permissions ?? [] };
  }

  async touchLastLogin(userId: number) {
    await this.db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
  }

  async createSession(s: { userId: number; tokenHash: string; ip: string | null; userAgent: string | null; expiresAt: Date }, q: Queryable = this.db) {
    const { rows } = await q.query(
      `INSERT INTO user_sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [s.userId, s.tokenHash, s.ip, s.userAgent?.slice(0, 500) ?? null, s.expiresAt],
    );
    return rows[0].id as string;
  }

  async findSessionByTokenHash(hash: string, q: Queryable = this.db): Promise<SessionRecord | null> {
    const { rows } = await q.query(
      `SELECT id, user_id, expires_at, revoked_at FROM user_sessions WHERE refresh_token_hash = $1 FOR UPDATE`,
      [hash],
    );
    const r = rows[0];
    return r ? { id: r.id, userId: r.user_id, expiresAt: r.expires_at, revokedAt: r.revoked_at } : null;
  }

  async revokeSession(id: string, q: Queryable = this.db) {
    await q.query(`UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  }

  async listSecurityEvents(f: { type?: string; userId?: number; severity?: string; since?: string; limit: number; offset: number }) {
    const where = `($1::text IS NULL OR e.event_type = $1)
               AND ($2::bigint IS NULL OR e.target_user_id = $2 OR e.actor_user_id = $2)
               AND ($3::text IS NULL OR e.severity = $3)
               AND ($4::timestamptz IS NULL OR e.occurred_at >= $4)`;
    const params = [f.type ?? null, f.userId ?? null, f.severity ?? null, f.since ?? null];
    const total = await this.db.query(`SELECT count(*)::int AS n FROM security_events e WHERE ${where}`, params);
    const { rows } = await this.db.query(
      `SELECT e.id, e.occurred_at, e.event_type, e.severity, e.actor_user_id, a.username AS actor_username,
              e.target_user_id, t.username AS target_username, e.username AS attempted_username,
              host(e.ip_address) AS ip_address, e.user_agent, e.details
         FROM security_events e
         LEFT JOIN users a ON a.id = e.actor_user_id
         LEFT JOIN users t ON t.id = e.target_user_id
        WHERE ${where}
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT $5 OFFSET $6`,
      [...params, f.limit, f.offset],
    );
    return { items: rowsToCamel(rows), total: total.rows[0].n as number };
  }

  async isSessionActive(sessionId: string, userId: number) {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND u.is_active AND u.deleted_at IS NULL`,
      [sessionId, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async permissionsOfRoles(roleNames: string[]) {
    const { rows } = await this.db.query(
      `SELECT DISTINCT p.code FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
        WHERE r.name = ANY($1::text[])`,
      [roleNames],
    );
    return rows.map((r) => r.code as string);
  }

  async revokeAllSessions(userId: number, q: Queryable = this.db) {
    await q.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }

  async updatePassword(userId: number, passwordHash: string, mustChange: boolean, q: Queryable = this.db) {
    await q.query(`UPDATE users SET password_hash = $2, must_change_password = $3 WHERE id = $1`, [userId, passwordHash, mustChange]);
  }

  // ---------------- user administration ----------------

  async listUsers(opts: { search?: string; limit: number; offset: number }) {
    const params: unknown[] = [];
    let where = 'u.deleted_at IS NULL';
    if (opts.search) {
      params.push(containsPattern(opts.search));
      where += ` AND (u.username ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1)`;
    }
    const total = await this.db.query(`SELECT count(*)::int AS n FROM users u WHERE ${where}`, params);
    params.push(opts.limit, opts.offset);
    const { rows } = await this.db.query(
      `SELECT u.id, u.username, u.email, u.phone, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
              COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
        WHERE ${where}
        GROUP BY u.id
        ORDER BY u.username
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const items: UserListItem[] = rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      phone: r.phone,
      isActive: r.is_active,
      mustChangePassword: r.must_change_password,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
      roles: r.roles,
    }));
    return { items, total: total.rows[0].n as number };
  }

  async createUser(u: { username: string; email?: string | null; phone?: string | null; passwordHash: string; mustChangePassword: boolean }, q: Queryable = this.db) {
    const { rows } = await q.query(
      `INSERT INTO users (username, email, phone, password_hash, must_change_password)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [u.username, u.email ?? null, u.phone ?? null, u.passwordHash, u.mustChangePassword],
    );
    return rows[0].id as number;
  }

  async updateUser(id: number, patch: { email?: string | null; phone?: string | null; isActive?: boolean }, q: Queryable = this.db) {
    const { rowCount } = await q.query(
      `UPDATE users SET
          email     = CASE WHEN $2::boolean THEN $3 ELSE email END,
          phone     = CASE WHEN $4::boolean THEN $5 ELSE phone END,
          is_active = COALESCE($6, is_active)
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, patch.email !== undefined, patch.email ?? null, patch.phone !== undefined, patch.phone ?? null, patch.isActive ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  async replaceRoles(userId: number, roleNames: string[], q: Queryable = this.db) {
    await q.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    if (roleNames.length) {
      await q.query(
        `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = ANY($2::text[])`,
        [userId, roleNames],
      );
    }
  }

  async findExistingRoles(roleNames: string[]) {
    const { rows } = await this.db.query(`SELECT name FROM roles WHERE name = ANY($1::text[])`, [roleNames]);
    return rows.map((r) => r.name as string);
  }

  async listRoles() {
    const { rows } = await this.db.query(
      `SELECT r.id, r.name, r.description,
              COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        GROUP BY r.id ORDER BY r.name`,
    );
    return rows;
  }
}

function mapUser(r: any): UserRecord {
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    phone: r.phone,
    passwordHash: r.password_hash,
    isActive: r.is_active,
    mustChangePassword: r.must_change_password,
  };
}
