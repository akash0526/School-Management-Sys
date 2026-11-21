import type { Database, Queryable } from '../../../shared/db/database.js';
import { rowsToCamel, toCamel } from '../../../shared/db/sql.js';
import type { EnrollmentPatch, EnrollmentRecord, EnrollmentRepository } from '../business/enrollment.ports.js';

const RECORD_COLS = 'id, student_id, academic_year_id, section_id, roll_no, symbol_no, status';

/** DATA LAYER — enrollment SQL. */
export class PgEnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly db: Database) {}

  async list(f: { sectionId?: number; academicYearId?: number; studentId?: number; status?: string }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.sectionId) where.push(`e.section_id = $${params.push(f.sectionId)}`);
    if (f.academicYearId) where.push(`e.academic_year_id = $${params.push(f.academicYearId)}`);
    if (f.studentId) where.push(`e.student_id = $${params.push(f.studentId)}`);
    if (f.status) where.push(`e.status = $${params.push(f.status)}`);
    const { rows } = await this.db.query(
      `SELECT e.id, e.student_id, s.admission_no, concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
              e.academic_year_id, ay.name AS academic_year, e.section_id, c.name AS class_name, sec.name AS section_name,
              e.roll_no, e.symbol_no, e.registration_no, e.status, e.enrolled_on
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         JOIN sections sec ON sec.id = e.section_id
         JOIN classes c ON c.id = sec.class_id
         JOIN academic_years ay ON ay.id = e.academic_year_id
        WHERE ${where.join(' AND ')}
        ORDER BY ay.start_date DESC, c.numeric_level, sec.name, e.roll_no NULLS LAST, s.first_name`,
      params,
    );
    return rowsToCamel(rows);
  }

  async findById(id: number, q: Queryable = this.db) {
    const { rows } = await q.query(`SELECT ${RECORD_COLS} FROM enrollments WHERE id = $1`, [id]);
    return rows[0] ? toCamel<EnrollmentRecord>(rows[0]) : null;
  }

  async create(e: { studentId: number; academicYearId: number; sectionId: number; rollNo?: number | null; symbolNo?: string | null; registrationNo?: string | null }, q: Queryable) {
    const { rows } = await q.query(
      `INSERT INTO enrollments (student_id, academic_year_id, section_id, roll_no, symbol_no, registration_no)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${RECORD_COLS}`,
      [e.studentId, e.academicYearId, e.sectionId, e.rollNo ?? null, e.symbolNo ?? null, e.registrationNo ?? null],
    );
    return toCamel<EnrollmentRecord>(rows[0]);
  }

  async update(id: number, p: EnrollmentPatch, q: Queryable) {
    const { rows } = await q.query(
      `UPDATE enrollments SET
          roll_no         = CASE WHEN $2::boolean THEN $3::smallint ELSE roll_no END,
          symbol_no       = CASE WHEN $4::boolean THEN $5 ELSE symbol_no END,
          registration_no = CASE WHEN $6::boolean THEN $7 ELSE registration_no END,
          status          = COALESCE($8, status),
          remarks         = CASE WHEN $9::boolean THEN $10 ELSE remarks END
        WHERE id = $1 RETURNING ${RECORD_COLS}`,
      [
        id,
        p.rollNo !== undefined, p.rollNo ?? null,
        p.symbolNo !== undefined, p.symbolNo ?? null,
        p.registrationNo !== undefined, p.registrationNo ?? null,
        p.status ?? null,
        p.remarks !== undefined, p.remarks ?? null,
      ],
    );
    return rows[0] ? toCamel<EnrollmentRecord>(rows[0]) : null;
  }

  async setStatus(id: number, status: string, q: Queryable) {
    await q.query(`UPDATE enrollments SET status = $2 WHERE id = $1`, [id, status]);
  }

  async listSubjects(enrollmentId: number) {
    const { rows } = await this.db.query(
      `SELECT cs.id AS class_subject_id, sub.code, sub.name, cs.optional_group
         FROM student_subjects ss
         JOIN class_subjects cs ON cs.id = ss.class_subject_id
         JOIN subjects sub ON sub.id = cs.subject_id
        WHERE ss.enrollment_id = $1 ORDER BY cs.sequence`,
      [enrollmentId],
    );
    return rowsToCamel(rows);
  }

  async replaceSubjects(enrollmentId: number, classSubjectIds: number[], q: Queryable) {
    await q.query(`DELETE FROM student_subjects WHERE enrollment_id = $1`, [enrollmentId]);
    if (classSubjectIds.length) {
      await q.query(
        `INSERT INTO student_subjects (enrollment_id, class_subject_id) SELECT $1, unnest($2::int[])`,
        [enrollmentId, classSubjectIds],
      );
    }
  }

  async assignRollNumbersAlphabetically(sectionId: number, q: Queryable) {
    // two steps so the UNIQUE(section_id, roll_no) constraint never collides mid-update
    await q.query(`UPDATE enrollments SET roll_no = NULL WHERE section_id = $1 AND status = 'studying'`, [sectionId]);
    const { rowCount } = await q.query(
      `UPDATE enrollments e SET roll_no = r.rn
         FROM (SELECT e2.id, row_number() OVER (ORDER BY s.first_name, s.middle_name NULLS FIRST, s.last_name) AS rn
                 FROM enrollments e2 JOIN students s ON s.id = e2.student_id
                WHERE e2.section_id = $1 AND e2.status = 'studying') r
        WHERE e.id = r.id`,
      [sectionId],
    );
    return rowCount ?? 0;
  }

  async listActiveBySection(sectionId: number) {
    const { rows } = await this.db.query(
      `SELECT e.id AS enrollment_id, e.student_id, e.roll_no,
              concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name
         FROM enrollments e JOIN students s ON s.id = e.student_id
        WHERE e.section_id = $1 AND e.status = 'studying'
        ORDER BY e.roll_no NULLS LAST, s.first_name`,
      [sectionId],
    );
    return rowsToCamel<{ enrollmentId: number; studentId: number; rollNo: number | null; studentName: string }>(rows);
  }
}
