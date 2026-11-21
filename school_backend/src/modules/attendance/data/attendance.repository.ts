import type { Database, Queryable } from '../../../shared/db/database.js';
import { rowsToCamel } from '../../../shared/db/sql.js';
import type { AttendanceRepository, StaffMark, StudentMark } from '../business/attendance.ports.js';

/** DATA LAYER — attendance SQL (bulk upserts with unnest for speed). */
export class PgAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: Database) {}

  async countActiveEnrollmentsInSection(sectionId: number, enrollmentIds: number[]) {
    const { rows } = await this.db.query(
      `SELECT count(*)::int AS n FROM enrollments WHERE section_id = $1 AND status = 'studying' AND id = ANY($2::bigint[])`,
      [sectionId, enrollmentIds],
    );
    return rows[0].n as number;
  }

  async upsertStudentMarks(date: string, periodId: number | null, marks: StudentMark[], markedBy: number, q: Queryable) {
    const { rowCount } = await q.query(
      `INSERT INTO student_attendance (enrollment_id, attendance_date, period_id, status, remarks, marked_by)
       SELECT m.enrollment_id, $1::date, $2::int, m.status, m.remarks, $3
         FROM unnest($4::bigint[], $5::text[], $6::text[]) AS m(enrollment_id, status, remarks)
       ON CONFLICT (enrollment_id, attendance_date, period_id)
       DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by`,
      [
        date,
        periodId,
        markedBy,
        marks.map((m) => m.enrollmentId),
        marks.map((m) => m.status),
        marks.map((m) => m.remarks ?? null),
      ],
    );
    return rowCount ?? 0;
  }

  async sectionRoster(sectionId: number, date: string, periodId: number | null) {
    const { rows } = await this.db.query(
      `SELECT e.id AS enrollment_id, e.roll_no, s.id AS student_id,
              concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
              a.status, a.remarks
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         LEFT JOIN student_attendance a
                ON a.enrollment_id = e.id AND a.attendance_date = $2 AND a.period_id IS NOT DISTINCT FROM $3::int
        WHERE e.section_id = $1 AND e.status = 'studying'
        ORDER BY e.roll_no NULLS LAST, s.first_name`,
      [sectionId, date, periodId],
    );
    return rowsToCamel(rows);
  }

  async studentRecords(studentId: number, from: string, to: string) {
    const { rows } = await this.db.query(
      `SELECT a.attendance_date, a.period_id, a.status, a.remarks
         FROM student_attendance a JOIN enrollments e ON e.id = a.enrollment_id
        WHERE e.student_id = $1 AND a.attendance_date BETWEEN $2 AND $3
        ORDER BY a.attendance_date DESC`,
      [studentId, from, to],
    );
    return rowsToCamel(rows);
  }

  async studentSummary(studentId: number, academicYearId?: number) {
    const { rows } = await this.db.query(
      `SELECT ay.id AS academic_year_id, ay.name AS academic_year,
              count(*) FILTER (WHERE a.status IN ('present','late','half_day'))::int AS present_days,
              count(*) FILTER (WHERE a.status = 'absent')::int AS absent_days,
              count(*) FILTER (WHERE a.status = 'late')::int AS late_days,
              count(*) FILTER (WHERE a.status = 'leave')::int AS leave_days,
              count(*)::int AS recorded_days
         FROM enrollments e
         JOIN academic_years ay ON ay.id = e.academic_year_id
         LEFT JOIN student_attendance a ON a.enrollment_id = e.id AND a.period_id IS NULL
        WHERE e.student_id = $1 AND ($2::int IS NULL OR e.academic_year_id = $2)
        GROUP BY ay.id ORDER BY ay.start_date DESC`,
      [studentId, academicYearId ?? null],
    );
    return rowsToCamel(rows);
  }

  async upsertStaffMarks(date: string, marks: StaffMark[], q: Queryable) {
    const { rowCount } = await q.query(
      `INSERT INTO staff_attendance (staff_id, attendance_date, status, check_in, check_out, remarks)
       SELECT m.staff_id, $1::date, m.status, m.check_in::time, m.check_out::time, m.remarks
         FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[]) AS m(staff_id, status, check_in, check_out, remarks)
       ON CONFLICT (staff_id, attendance_date)
       DO UPDATE SET status = EXCLUDED.status, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out, remarks = EXCLUDED.remarks`,
      [
        date,
        marks.map((m) => m.staffId),
        marks.map((m) => m.status),
        marks.map((m) => m.checkIn ?? null),
        marks.map((m) => m.checkOut ?? null),
        marks.map((m) => m.remarks ?? null),
      ],
    );
    return rowCount ?? 0;
  }

  async listStaffAttendance(date: string) {
    const { rows } = await this.db.query(
      `SELECT st.id AS staff_id, st.employee_no, concat_ws(' ', st.first_name, st.last_name) AS staff_name,
              st.designation, a.status, a.check_in, a.check_out, a.remarks
         FROM staff st
         LEFT JOIN staff_attendance a ON a.staff_id = st.id AND a.attendance_date = $1
        WHERE st.status = 'active' AND st.deleted_at IS NULL
        ORDER BY st.first_name`,
      [date],
    );
    return rowsToCamel(rows);
  }
}
