import type { Database, Queryable } from '../../../shared/db/database.js';
import { rowsToCamel, toCamel } from '../../../shared/db/sql.js';
import type { ApiClientRecord, InquiryInput, PublicRepository } from '../business/public.ports.js';

/**
 * DATA LAYER — public website API.
 * Reads ONLY the public_* views (no phones, addresses, fees, salaries).
 * Writes ONLY admission_inquiries. This keeps it compatible with the
 * restricted `website_api` DB role described in 11_audit_views.sql.
 */
export class PgPublicRepository implements PublicRepository {
  constructor(private readonly db: Database) {}

  async findClientByKeyHash(hash: string) {
    const { rows } = await this.db.query(
      `SELECT id, name, scopes, allowed_ips::text[] AS allowed_ips, is_active FROM api_clients WHERE api_key_hash = $1`,
      [hash],
    );
    return rows[0] ? toCamel<ApiClientRecord>(rows[0]) : null;
  }
  async touchClient(id: number) {
    await this.db.query(`UPDATE api_clients SET last_used_at = now() WHERE id = $1`, [id]);
  }
  async setClientActive(name: string, active: boolean, q: Queryable) {
    return ((await q.query(`UPDATE api_clients SET is_active = $2 WHERE name = $1`, [name, active])).rowCount ?? 0) > 0;
  }
  async rotateClientKey(name: string, keyHash: string, q: Queryable) {
    return ((await q.query(`UPDATE api_clients SET api_key_hash = $2, is_active = TRUE WHERE name = $1`, [name, keyHash])).rowCount ?? 0) > 0;
  }
  async createClient(c: { name: string; keyHash: string; scopes: string[]; allowedIps: string[] | null }, q: Queryable) {
    const { rows } = await q.query(
      `INSERT INTO api_clients (name, api_key_hash, scopes, allowed_ips) VALUES ($1,$2,$3,$4::inet[]) RETURNING id`,
      [c.name, c.keyHash, c.scopes, c.allowedIps],
    );
    return rows[0].id as number;
  }

  async schoolProfile() {
    const { rows } = await this.db.query(
      `SELECT name, name_np, address, phone, email, website, school_code, established_year, logo_url, updated_at FROM school_profile WHERE id = 1`,
    );
    return rows[0] ? toCamel(rows[0]) : null;
  }

  async notices(f: { updatedSince?: string; limit: number; offset: number }) {
    const total = await this.db.query(`SELECT count(*)::int AS n FROM public_notices WHERE ($1::timestamptz IS NULL OR updated_at > $1)`, [f.updatedSince ?? null]);
    const { rows } = await this.db.query(
      `SELECT * FROM public_notices WHERE ($1::timestamptz IS NULL OR updated_at > $1)
        ORDER BY publish_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [f.updatedSince ?? null, f.limit, f.offset],
    );
    return { items: rowsToCamel(rows), total: total.rows[0].n as number };
  }
  async notice(id: number) {
    const { rows } = await this.db.query(`SELECT * FROM public_notices WHERE id = $1`, [id]);
    return rows[0] ? toCamel(rows[0]) : null;
  }

  async events(f: { from?: string; to?: string; limit: number; offset: number }) {
    const where = `($1::date IS NULL OR COALESCE(end_at, start_at) >= $1::date) AND ($2::date IS NULL OR start_at < ($2::date + 1))`;
    const params = [f.from ?? null, f.to ?? null];
    const total = await this.db.query(`SELECT count(*)::int AS n FROM public_events WHERE ${where}`, params);
    const { rows } = await this.db.query(`SELECT * FROM public_events WHERE ${where} ORDER BY start_at LIMIT $3 OFFSET $4`, [...params, f.limit, f.offset]);
    return { items: rowsToCamel(rows), total: total.rows[0].n as number };
  }

  async staff() {
    const { rows } = await this.db.query(`SELECT * FROM public_staff ORDER BY website_order NULLS LAST, full_name`);
    return rowsToCamel(rows);
  }

  async classes() {
    const { rows } = await this.db.query(`SELECT id, name FROM classes ORDER BY numeric_level`);
    return rowsToCamel<{ id: number; name: string }>(rows);
  }

  async classIdByName(name: string) {
    const { rows } = await this.db.query(`SELECT id FROM classes WHERE lower(name) = lower($1) LIMIT 1`, [name.trim()]);
    return (rows[0]?.id as number) ?? null;
  }

  async findInquiryByExternalRef(ref: string) {
    const { rows } = await this.db.query(`SELECT id FROM admission_inquiries WHERE external_ref = $1`, [ref]);
    return (rows[0]?.id as number) ?? null;
  }

  async createInquiry(i: InquiryInput & { applyingClassId: number | null }, q: Queryable) {
    const { rows } = await q.query(
      `INSERT INTO admission_inquiries (source, external_ref, student_name, dob, gender, applying_class_id, stream_id, guardian_name, phone, email, message)
       VALUES ('website',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (external_ref) DO UPDATE SET external_ref = EXCLUDED.external_ref
       RETURNING id`,
      [i.externalRef ?? null, i.studentName, i.dob ?? null, i.gender ?? null, i.applyingClassId, i.streamId ?? null, i.guardianName ?? null, i.phone, i.email ?? null, i.message ?? null],
    );
    return rows[0].id as number;
  }

  async lookupResults(f: { symbolNo?: string; admissionNo?: string; dob: string; examId?: number }) {
    // dob is used ONLY in WHERE — never selected / returned
    const { rows } = await this.db.query(
      `SELECT exam_id, exam_name, academic_year, symbol_no, student_name, class_name, section_name, gpa, final_grade, result_status
         FROM public_results
        WHERE dob = $1
          AND (($2::text IS NOT NULL AND upper(symbol_no) = upper($2)) OR ($3::text IS NOT NULL AND upper(admission_no) = upper($3)))
          AND ($4::int IS NULL OR exam_id = $4)
        ORDER BY exam_id DESC
        LIMIT 20`,
      [f.dob, f.symbolNo ?? null, f.admissionNo ?? null, f.examId ?? null],
    );
    return rowsToCamel(rows);
  }
}
