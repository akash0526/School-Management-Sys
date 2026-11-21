import type { Database, Queryable } from '../../../shared/db/database.js';
import { rowsToCamel, toCamel } from '../../../shared/db/sql.js';
import type { AcademicRepository, ClassSubjectInfo, SectionInfo } from '../business/academic.ports.js';

/** DATA LAYER — academic structure SQL. */
export class PgAcademicRepository implements AcademicRepository {
  constructor(private readonly db: Database) {}

  private async all(sql: string, params: unknown[] = [], q: Queryable = this.db) {
    return rowsToCamel((await q.query(sql, params)).rows);
  }
  private async one(sql: string, params: unknown[] = [], q: Queryable = this.db) {
    const { rows } = await q.query(sql, params);
    return rows[0] ? toCamel(rows[0]) : null;
  }

  // ---------------- years & terms ----------------
  listYears() {
    return this.all(`SELECT id, name, start_date, end_date, is_current FROM academic_years ORDER BY start_date DESC`);
  }
  async createYear(y: { name: string; startDate: string; endDate: string }, q: Queryable = this.db) {
    return (await this.one(
      `INSERT INTO academic_years (name, start_date, end_date) VALUES ($1, $2, $3) RETURNING *`,
      [y.name, y.startDate, y.endDate],
      q,
    ))!;
  }
  async setCurrentYear(id: number, q: Queryable) {
    const exists = await q.query(`SELECT 1 FROM academic_years WHERE id = $1`, [id]);
    if (!exists.rowCount) return false;
    await q.query(`UPDATE academic_years SET is_current = false WHERE is_current`);
    await q.query(`UPDATE academic_years SET is_current = true WHERE id = $1`, [id]);
    return true;
  }
  async getCurrentYearId() {
    const { rows } = await this.db.query(`SELECT id FROM academic_years WHERE is_current`);
    return (rows[0]?.id as number) ?? null;
  }
  async getYear(id: number) {
    return (await this.one(`SELECT id, start_date, end_date FROM academic_years WHERE id = $1`, [id])) as
      | { id: number; startDate: string; endDate: string }
      | null;
  }
  listTerms(yearId: number) {
    return this.all(`SELECT * FROM terms WHERE academic_year_id = $1 ORDER BY sequence`, [yearId]);
  }
  async createTerm(t: { academicYearId: number; name: string; sequence: number; startDate: string; endDate: string }, q: Queryable = this.db) {
    return (await this.one(
      `INSERT INTO terms (academic_year_id, name, sequence, start_date, end_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [t.academicYearId, t.name, t.sequence, t.startDate, t.endDate],
      q,
    ))!;
  }

  // ---------------- structure ----------------
  listClasses() {
    return this.all(`SELECT id, name, numeric_level, level_group FROM classes ORDER BY numeric_level`);
  }
  listStreams() {
    return this.all(`SELECT id, name FROM streams ORDER BY name`);
  }
  listRooms() {
    return this.all(`SELECT * FROM rooms ORDER BY name`);
  }

  listSections(f: { academicYearId?: number; classId?: number }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.academicYearId) where.push(`s.academic_year_id = $${params.push(f.academicYearId)}`);
    if (f.classId) where.push(`s.class_id = $${params.push(f.classId)}`);
    return this.all(
      `SELECT s.id, s.academic_year_id, s.class_id, c.name AS class_name, s.stream_id, st.name AS stream_name,
              s.name, s.class_teacher_id, concat_ws(' ', t.first_name, t.last_name) AS class_teacher_name,
              s.room_id, s.capacity,
              (SELECT count(*)::int FROM enrollments e WHERE e.section_id = s.id AND e.status = 'studying') AS student_count
         FROM sections s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN streams st ON st.id = s.stream_id
         LEFT JOIN staff t ON t.id = s.class_teacher_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY c.numeric_level, s.name`,
      params,
    );
  }
  async getSection(id: number) {
    return (await this.one(
      `SELECT id, academic_year_id, class_id, stream_id, name, class_teacher_id FROM sections WHERE id = $1`,
      [id],
    )) as SectionInfo | null;
  }
  async createSection(s: { academicYearId: number; classId: number; streamId?: number | null; name: string; classTeacherId?: number | null; roomId?: number | null; capacity?: number | null }, q: Queryable = this.db) {
    return (await this.one(
      `INSERT INTO sections (academic_year_id, class_id, stream_id, name, class_teacher_id, room_id, capacity)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [s.academicYearId, s.classId, s.streamId ?? null, s.name, s.classTeacherId ?? null, s.roomId ?? null, s.capacity ?? null],
      q,
    ))!;
  }
  async updateSection(id: number, s: { name?: string; classTeacherId?: number | null; roomId?: number | null; capacity?: number | null; streamId?: number | null }, q: Queryable = this.db) {
    return this.one(
      `UPDATE sections SET
          name             = COALESCE($2, name),
          class_teacher_id = CASE WHEN $3::boolean THEN $4 ELSE class_teacher_id END,
          room_id          = CASE WHEN $5::boolean THEN $6 ELSE room_id END,
          capacity         = CASE WHEN $7::boolean THEN $8 ELSE capacity END,
          stream_id        = CASE WHEN $9::boolean THEN $10 ELSE stream_id END
        WHERE id = $1 RETURNING *`,
      [
        id,
        s.name ?? null,
        s.classTeacherId !== undefined, s.classTeacherId ?? null,
        s.roomId !== undefined, s.roomId ?? null,
        s.capacity !== undefined, s.capacity ?? null,
        s.streamId !== undefined, s.streamId ?? null,
      ],
      q,
    );
  }

  listSubjects() {
    return this.all(`SELECT * FROM subjects WHERE is_active ORDER BY name`);
  }
  async createSubject(s: { code: string; name: string; nameNp?: string | null; hasPractical?: boolean }, q: Queryable = this.db) {
    return (await this.one(
      `INSERT INTO subjects (code, name, name_np, has_practical) VALUES ($1,$2,$3,$4) RETURNING *`,
      [s.code, s.name, s.nameNp ?? null, s.hasPractical ?? false],
      q,
    ))!;
  }

  listClassSubjects(f: { academicYearId: number; classId?: number; streamId?: number }) {
    const params: unknown[] = [f.academicYearId];
    const where = ['cs.academic_year_id = $1'];
    if (f.classId) where.push(`cs.class_id = $${params.push(f.classId)}`);
    if (f.streamId) where.push(`(cs.stream_id IS NULL OR cs.stream_id = $${params.push(f.streamId)})`);
    return this.all(
      `SELECT cs.*, sub.code AS subject_code, sub.name AS subject_name, c.name AS class_name, st.name AS stream_name
         FROM class_subjects cs
         JOIN subjects sub ON sub.id = cs.subject_id
         JOIN classes c ON c.id = cs.class_id
         LEFT JOIN streams st ON st.id = cs.stream_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.numeric_level, cs.sequence, sub.name`,
      params,
    );
  }
  async createClassSubject(c: { academicYearId: number; classId: number; streamId?: number | null; subjectId: number; creditHours?: number | null; isOptional?: boolean; optionalGroup?: string | null; sequence?: number }, q: Queryable = this.db) {
    return (await this.one(
      `INSERT INTO class_subjects (academic_year_id, class_id, stream_id, subject_id, credit_hours, is_optional, optional_group, sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [c.academicYearId, c.classId, c.streamId ?? null, c.subjectId, c.creditHours ?? null, c.isOptional ?? false, c.optionalGroup ?? null, c.sequence ?? 0],
      q,
    ))!;
  }
  async getClassSubject(id: number) {
    return (await this.one(
      `SELECT id, academic_year_id, class_id, stream_id, is_optional, optional_group FROM class_subjects WHERE id = $1`,
      [id],
    )) as ClassSubjectInfo | null;
  }

  listTeacherAssignments(f: { academicYearId?: number; staffId?: number; sectionId?: number }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.academicYearId) where.push(`ta.academic_year_id = $${params.push(f.academicYearId)}`);
    if (f.staffId) where.push(`ta.staff_id = $${params.push(f.staffId)}`);
    if (f.sectionId) where.push(`ta.section_id = $${params.push(f.sectionId)}`);
    return this.all(
      `SELECT ta.*, concat_ws(' ', st.first_name, st.last_name) AS teacher_name,
              c.name AS class_name, s.name AS section_name, sub.name AS subject_name
         FROM teacher_assignments ta
         JOIN staff st ON st.id = ta.staff_id
         JOIN sections s ON s.id = ta.section_id
         JOIN classes c ON c.id = s.class_id
         JOIN class_subjects cs ON cs.id = ta.class_subject_id
         JOIN subjects sub ON sub.id = cs.subject_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY c.numeric_level, s.name, sub.name`,
      params,
    );
  }
  async createTeacherAssignment(a: { academicYearId: number; sectionId: number; classSubjectId: number; staffId: number }, q: Queryable = this.db) {
    return (await this.one(
      `INSERT INTO teacher_assignments (academic_year_id, section_id, class_subject_id, staff_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [a.academicYearId, a.sectionId, a.classSubjectId, a.staffId],
      q,
    ))!;
  }
  async deleteTeacherAssignment(id: number, q: Queryable = this.db) {
    return ((await q.query(`DELETE FROM teacher_assignments WHERE id = $1`, [id])).rowCount ?? 0) > 0;
  }
  async isTeacherAssigned(staffId: number, sectionId: number, classSubjectId?: number) {
    const params: unknown[] = [staffId, sectionId];
    let sql = `SELECT 1 FROM teacher_assignments WHERE staff_id = $1 AND section_id = $2`;
    if (classSubjectId) sql += ` AND class_subject_id = $${params.push(classSubjectId)}`;
    return ((await this.db.query(sql + ' LIMIT 1', params)).rowCount ?? 0) > 0;
  }
  async isClassTeacher(staffId: number, sectionId: number) {
    return ((await this.db.query(`SELECT 1 FROM sections WHERE id = $1 AND class_teacher_id = $2`, [sectionId, staffId])).rowCount ?? 0) > 0;
  }

  listCalendar(yearId: number) {
    return this.all(`SELECT * FROM school_calendar WHERE academic_year_id = $1 ORDER BY start_date`, [yearId]);
  }
  async createCalendarEntry(e: { academicYearId: number; title: string; startDate: string; endDate: string; dayType: string; isHoliday: boolean }, q: Queryable = this.db) {
    return (await this.one(
      `INSERT INTO school_calendar (academic_year_id, title, start_date, end_date, day_type, is_holiday)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [e.academicYearId, e.title, e.startDate, e.endDate, e.dayType, e.isHoliday],
      q,
    ))!;
  }
  async isHoliday(date: string) {
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM school_calendar WHERE is_holiday AND $1::date BETWEEN start_date AND end_date LIMIT 1`,
      [date],
    );
    return (rowCount ?? 0) > 0;
  }
}
