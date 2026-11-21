import type { Database, Queryable } from '../../../shared/db/database.js';
import { buildInsert, buildUpdate, type ColumnMap, rowsToCamel, toCamel, containsPattern } from '../../../shared/db/sql.js';
import type { Guardian, GuardianInput, Student, StudentInput, StudentsRepository, StudentStatus } from '../business/students.ports.js';

const STUDENT_COLUMNS: ColumnMap<StudentInput> = {
  admissionNo: 'admission_no',
  firstName: 'first_name',
  middleName: 'middle_name',
  lastName: 'last_name',
  fullNameNp: 'full_name_np',
  gender: 'gender',
  dob: 'dob',
  bloodGroup: 'blood_group',
  religion: 'religion',
  casteEthnicity: 'caste_ethnicity',
  motherTongue: 'mother_tongue',
  nationality: 'nationality',
  disabilityType: 'disability_type',
  birthCertNo: 'birth_cert_no',
  province: 'province',
  district: 'district',
  localLevel: 'local_level',
  wardNo: 'ward_no',
  tole: 'tole',
  temporaryAddress: 'temporary_address',
  phone: 'phone',
  email: 'email',
  photoUrl: 'photo_url',
  previousSchool: 'previous_school',
  admissionDate: 'admission_date',
  customFields: 'custom_fields',
};

const GUARDIAN_COLUMNS: ColumnMap<GuardianInput> = {
  fullName: 'full_name',
  phone: 'phone',
  altPhone: 'alt_phone',
  email: 'email',
  occupation: 'occupation',
  organization: 'organization',
  citizenshipNo: 'citizenship_no',
  address: 'address',
};

/** Current-year class/section joined onto student lists. */
const CURRENT_CLASS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT c.name AS class_name, sec.name AS section_name, e.roll_no, e.id AS enrollment_id
      FROM enrollments e
      JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.is_current
      JOIN sections sec ON sec.id = e.section_id
      JOIN classes c ON c.id = sec.class_id
     WHERE e.student_id = s.id
     LIMIT 1
  ) cur ON true`;

/** DATA LAYER — SQL for students & guardians. */
export class PgStudentsRepository implements StudentsRepository {
  constructor(private readonly db: Database) {}

  async list(f: { search?: string; status?: string; limit: number; offset: number }) {
    const params: unknown[] = [];
    const where = ['s.deleted_at IS NULL'];
    if (f.search) {
      params.push(containsPattern(f.search));
      where.push(`(s.admission_no ILIKE $${params.length} OR (s.first_name || ' ' || s.last_name) ILIKE $${params.length})`);
    }
    if (f.status) {
      params.push(f.status);
      where.push(`s.status = $${params.length}`);
    }
    const w = where.join(' AND ');
    const total = await this.db.query(`SELECT count(*)::int AS n FROM students s WHERE ${w}`, params);
    params.push(f.limit, f.offset);
    const { rows } = await this.db.query(
      `SELECT s.id, s.admission_no, s.first_name, s.middle_name, s.last_name, s.gender, s.dob, s.phone, s.status,
              s.photo_url, cur.class_name, cur.section_name, cur.roll_no, cur.enrollment_id
         FROM students s ${CURRENT_CLASS_JOIN}
        WHERE ${w}
        ORDER BY s.first_name, s.last_name
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel<Student>(rows), total: total.rows[0].n as number };
  }

  async findById(id: number, q: Queryable = this.db) {
    const { rows } = await q.query(
      `SELECT s.*, cur.class_name, cur.section_name, cur.roll_no, cur.enrollment_id
         FROM students s ${CURRENT_CLASS_JOIN}
        WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? toCamel<Student>(rows[0]) : null;
  }

  async findIdByUserId(userId: number) {
    const { rows } = await this.db.query(`SELECT id FROM students WHERE user_id = $1 AND deleted_at IS NULL`, [userId]);
    return (rows[0]?.id as number) ?? null;
  }

  async getStatus(id: number) {
    const { rows } = await this.db.query(`SELECT status FROM students WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return (rows[0]?.status as string) ?? null;
  }

  async create(input: StudentInput, q: Queryable = this.db) {
    const { text, values } = buildInsert('students', STUDENT_COLUMNS, input);
    const { rows } = await q.query(text, values);
    return toCamel<Student>(rows[0]);
  }

  async update(id: number, input: Partial<StudentInput>, q: Queryable = this.db) {
    const sql = buildUpdate('students', STUDENT_COLUMNS, input, id, 'AND deleted_at IS NULL');
    if (!sql) return this.findById(id, q);
    const { rows } = await q.query(sql.text, sql.values);
    return rows[0] ? toCamel<Student>(rows[0]) : null;
  }

  async setStatus(id: number, status: StudentStatus, leftDate: string | null, q: Queryable) {
    await q.query(`UPDATE students SET status = $2, left_date = $3 WHERE id = $1`, [id, status, leftDate]);
  }

  async addStatusHistory(h: { studentId: number; oldStatus: string; newStatus: string; changedOn: string; reason?: string | null; changedBy: number }, q: Queryable) {
    await q.query(
      `INSERT INTO student_status_history (student_id, old_status, new_status, changed_on, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [h.studentId, h.oldStatus, h.newStatus, h.changedOn, h.reason ?? null, h.changedBy],
    );
  }

  async setUserId(studentId: number, userId: number, q: Queryable) {
    await q.query(`UPDATE students SET user_id = $2 WHERE id = $1`, [studentId, userId]);
  }

  async isGuardianOf(guardianId: number, studentId: number) {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM student_guardians WHERE guardian_id = $1 AND student_id = $2`,
      [guardianId, studentId],
    );
    return (rowCount ?? 0) > 0;
  }

  async listGuardiansOfStudent(studentId: number) {
    const { rows } = await this.db.query(
      `SELECT g.id, g.full_name, g.phone, g.alt_phone, g.email, g.occupation, g.user_id, sg.relation, sg.is_primary, sg.can_pickup
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 AND g.deleted_at IS NULL
        ORDER BY sg.is_primary DESC, g.full_name`,
      [studentId],
    );
    return rowsToCamel(rows);
  }

  async linkGuardian(l: { studentId: number; guardianId: number; relation: string; isPrimary: boolean; canPickup: boolean }, q: Queryable) {
    if (l.isPrimary) {
      await q.query(`UPDATE student_guardians SET is_primary = false WHERE student_id = $1`, [l.studentId]);
    }
    await q.query(
      `INSERT INTO student_guardians (student_id, guardian_id, relation, is_primary, can_pickup)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, guardian_id)
       DO UPDATE SET relation = EXCLUDED.relation, is_primary = EXCLUDED.is_primary, can_pickup = EXCLUDED.can_pickup`,
      [l.studentId, l.guardianId, l.relation, l.isPrimary, l.canPickup],
    );
  }

  async unlinkGuardian(studentId: number, guardianId: number, q: Queryable = this.db) {
    const { rowCount } = await q.query(`DELETE FROM student_guardians WHERE student_id = $1 AND guardian_id = $2`, [studentId, guardianId]);
    return (rowCount ?? 0) > 0;
  }

  async listChildrenOfGuardian(guardianId: number) {
    const { rows } = await this.db.query(
      `SELECT s.id, s.admission_no, s.first_name, s.middle_name, s.last_name, s.photo_url, s.status,
              cur.class_name, cur.section_name, cur.roll_no, cur.enrollment_id, sg.relation
         FROM student_guardians sg
         JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
         ${CURRENT_CLASS_JOIN}
        WHERE sg.guardian_id = $1
        ORDER BY s.first_name`,
      [guardianId],
    );
    return rowsToCamel(rows);
  }

  async listGuardians(f: { search?: string; limit: number; offset: number }) {
    const params: unknown[] = [];
    let where = 'g.deleted_at IS NULL';
    if (f.search) {
      params.push(containsPattern(f.search));
      where += ` AND (g.full_name ILIKE $1 OR g.phone ILIKE $1)`;
    }
    const total = await this.db.query(`SELECT count(*)::int AS n FROM guardians g WHERE ${where}`, params);
    params.push(f.limit, f.offset);
    const { rows } = await this.db.query(
      `SELECT g.id, g.full_name, g.phone, g.email, g.occupation, g.user_id,
              (SELECT COALESCE(json_agg(json_build_object('studentId', s.id, 'name', concat_ws(' ', s.first_name, s.last_name),
                                                          'admissionNo', s.admission_no, 'relation', sg.relation) ORDER BY s.first_name), '[]')
                 FROM student_guardians sg JOIN students s ON s.id = sg.student_id
                WHERE sg.guardian_id = g.id AND s.deleted_at IS NULL) AS children
         FROM guardians g WHERE ${where}
        ORDER BY g.full_name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel<Guardian>(rows), total: total.rows[0].n as number };
  }

  async findGuardianById(id: number, q: Queryable = this.db) {
    const { rows } = await q.query(`SELECT * FROM guardians WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return rows[0] ? toCamel<Guardian>(rows[0]) : null;
  }

  async findGuardianIdByUserId(userId: number) {
    const { rows } = await this.db.query(`SELECT id FROM guardians WHERE user_id = $1 AND deleted_at IS NULL`, [userId]);
    return (rows[0]?.id as number) ?? null;
  }

  async createGuardian(input: GuardianInput, q: Queryable = this.db) {
    const { text, values } = buildInsert('guardians', GUARDIAN_COLUMNS, input);
    const { rows } = await q.query(text, values);
    return toCamel<Guardian>(rows[0]);
  }

  async updateGuardian(id: number, input: Partial<GuardianInput>, q: Queryable = this.db) {
    const sql = buildUpdate('guardians', GUARDIAN_COLUMNS, input, id, 'AND deleted_at IS NULL');
    if (!sql) return this.findGuardianById(id, q);
    const { rows } = await q.query(sql.text, sql.values);
    return rows[0] ? toCamel<Guardian>(rows[0]) : null;
  }

  async setGuardianUserId(guardianId: number, userId: number, q: Queryable) {
    await q.query(`UPDATE guardians SET user_id = $2 WHERE id = $1`, [guardianId, userId]);
  }
}
