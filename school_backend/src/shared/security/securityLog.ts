import type { Logger } from 'pino';
import type { Queryable } from '../db/database.js';

export type SecurityEventType =
  | 'login_success'
  | 'login_failed'
  | 'account_locked'
  | 'logout'
  | 'refresh_reuse'
  | 'password_changed'
  | 'password_change_failed'
  | 'password_reset'
  | 'roles_changed'
  | 'account_created'
  | 'account_deactivated'
  | 'account_reactivated'
  | 'privilege_escalation_blocked'
  | 'api_key_rejected'
  | 'api_key_ip_blocked'
  | 'result_lookup_throttled';

export interface SecurityEvent {
  type: SecurityEventType;
  severity?: 'info' | 'warning' | 'critical';
  actorUserId?: number | null;
  targetUserId?: number | null;
  username?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}

/** Cross-cutting: every module may record security events. Never throws, never blocks a request. */
export interface SecurityLog {
  record(event: SecurityEvent): void;
}

/**
 * Writes to the append-only `security_events` table (outside any business transaction,
 * so a failed login is recorded even though the request fails) and to the app log.
 * A per-(type, ip) cap stops an attacker from flooding the table.
 */
export function createSecurityLog(db: Queryable, logger: Logger, opts: { maxPerMinutePerSource?: number } = {}): SecurityLog {
  const cap = opts.maxPerMinutePerSource ?? 30;
  const counters = new Map<string, { n: number; resetAt: number }>();

  const allowed = (key: string) => {
    const now = Date.now();
    const c = counters.get(key);
    if (!c || c.resetAt <= now) {
      if (counters.size > 10_000) counters.clear();
      counters.set(key, { n: 1, resetAt: now + 60_000 });
      return true;
    }
    c.n += 1;
    if (c.n === cap + 1) logger.warn({ securityEvent: key }, 'Security event rate cap reached — further events from this source are only counted');
    return c.n <= cap;
  };

  return {
    record(e) {
      const severity = e.severity ?? (e.type.includes('failed') || e.type.includes('rejected') ? 'warning' : 'info');
      const logLine = { ...e.details, securityEvent: e.type, severity, actorUserId: e.actorUserId, targetUserId: e.targetUserId, username: e.username, ip: e.ip };
      if (severity === 'info') logger.info(logLine, `security: ${e.type}`);
      else logger.warn(logLine, `security: ${e.type}`);

      if (!allowed(`${e.type}:${e.ip ?? '-'}`)) return;
      const ip = e.ip?.replace(/^::ffff:/, '') ?? null;
      db.query(
        `INSERT INTO security_events (event_type, severity, actor_user_id, target_user_id, username, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8)`,
        [e.type, severity, e.actorUserId ?? null, e.targetUserId ?? null, e.username?.slice(0, 100) ?? null, ip, e.userAgent?.slice(0, 500) ?? null, JSON.stringify(e.details ?? {})],
      ).catch((err) => logger.error({ err, securityEvent: e.type }, 'Failed to persist security event'));
    },
  };
}

/** For unit tests / scripts. */
export const nullSecurityLog: SecurityLog = { record: () => undefined };
