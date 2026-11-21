import type { Queryable, Tx } from '../../../shared/db/database.js';
import { toCamel } from '../../../shared/db/sql.js';
import type { DemoAccount, ProfileInput, SchoolProfile, SchoolRepository } from '../business/school.ports.js';

const COLS = `name, name_np, address, phone, email, website, pan_no, school_code, established_year, logo_url, updated_at`;

/** DATA LAYER — the single-row school_profile table. */
export class PgSchoolRepository implements SchoolRepository {
  constructor(private readonly db: Queryable) {}

  async getProfile() {
    const { rows } = await this.db.query(`SELECT ${COLS} FROM school_profile WHERE id = 1`);
    return rows[0] ? toCamel<SchoolProfile>(rows[0]) : null;
  }

  async getDemoAccounts() {
    const { rows } = await this.db.query(`SELECT value FROM settings WHERE key = 'demo_accounts'`);
    return Array.isArray(rows[0]?.value) ? (rows[0].value as DemoAccount[]) : null;
  }

  async saveProfile(p: ProfileInput, tx: Tx) {
    const { rows } = await tx.query(
      `INSERT INTO school_profile (id, name, name_np, address, phone, email, website, pan_no, school_code, established_year)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, name_np = EXCLUDED.name_np, address = EXCLUDED.address, phone = EXCLUDED.phone,
         email = EXCLUDED.email, website = EXCLUDED.website, pan_no = EXCLUDED.pan_no, school_code = EXCLUDED.school_code,
         established_year = EXCLUDED.established_year, updated_at = now()
       RETURNING ${COLS}`,
      [p.name, p.nameNp, p.address, p.phone, p.email, p.website, p.panNo, p.schoolCode, p.establishedYear],
    );
    return toCamel<SchoolProfile>(rows[0]);
  }

  async setLogo(logoUrl: string | null, tx: Tx) {
    const { rows } = await tx.query(`UPDATE school_profile SET logo_url = $1, updated_at = now() WHERE id = 1 RETURNING ${COLS}`, [logoUrl]);
    return rows[0] ? toCamel<SchoolProfile>(rows[0]) : null;
  }
}
