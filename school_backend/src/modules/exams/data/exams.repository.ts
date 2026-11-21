import type { Database, Queryable } from '../../../shared/db/database.js';
import { rowsToCamel, toCamel } from '../../../shared/db/sql.js';
import type {
  ComponentContext,
  ComponentInputDto,
  ExamInput,
  ExamRecord,
  ExamsRepository,
  MarkEntry,
  ProcessedResult,
  ResultInputRow,
} from '../business/exams.ports.js';
import type { GradeBand } from '../business/grading.js';

/** Students of a section who take a class subject (compulsory, or optional AND chosen). */
const TAKES_SUBJECT = `
  (cs.stream_id IS NULL OR cs.stream_id = sec.stream_id)
  AND (NOT cs.is_optional OR EXISTS (
        SELECT 1 FROM student_subjects ss WHERE ss.enrollment_id = e.id AND ss.class_subject_id = cs.id))`;

/** DATA LAYER — exams, marks, results SQL. */
export class PgExamsRepository implements ExamsRepository {
  constructor(private readonly db: Database) {}

  async listExams(academicYearId?: number) {
    const { rows } = await this.db.query(
      `SELECT ex.*, ay.name AS academic_year, t.name AS term_name
         FROM exams ex JOIN academic_years ay ON ay.id = ex.academic_year_id LEFT JOIN terms t ON t.id = ex.term_id
        WHERE ($1::int IS NULL OR ex.academic_year_id = $1)
        ORDER BY ex.start_date DESC NULLS LAST, ex.id DESC`,
      [academicYearId ?? null],
    );
    return rowsToCamel(rows);
  }

  async getExam(id: number, q: Queryable = this.db) {
    const { rows } = await q.query(`SELECT id, academic_year_id, name, is_published, grading_scale_id FROM exams WHERE id = $1`, [id]);
    return rows[0] ? toCamel<ExamRecord>(rows[0]) : null;
  }

  async createExam(i: ExamInput, q: Queryable) {
    const { rows } = await q.query(
      `INSERT INTO exams (academic_year_id, term_id, name, exam_type, grading_scale_id, weightage_in_final, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [i.academicYearId, i.termId ?? null, i.name, i.examType, i.gradingScaleId ?? null, i.weightageInFinal ?? null, i.startDate ?? null, i.endDate ?? null],
    );
    return toCamel(rows[0]);
  }

  async updateExam(id: number, i: Partial<ExamInput>, q: Queryable) {
    const { rows } = await q.query(
      `UPDATE exams SET
          name       = COALESCE($2, name),
          exam_type  = COALESCE($3, exam_type),
          start_date = CASE WHEN $4::boolean THEN $5::date ELSE start_date END,
          end_date   = CASE WHEN $6::boolean THEN $7::date ELSE end_date END,
          grading_scale_id = CASE WHEN $8::boolean THEN $9::int ELSE grading_scale_id END
        WHERE id = $1 RETURNING *`,
      [
        id,
        i.name ?? null,
        i.examType ?? null,
        i.startDate !== undefined, i.startDate ?? null,
        i.endDate !== undefined, i.endDate ?? null,
        i.gradingScaleId !== undefined, i.gradingScaleId ?? null,
      ],
    );
    return rows[0] ? toCamel(rows[0]) : null;
  }

  async createSchedule(
    examId: number,
    s: { classSubjectId: number; examDate?: string | null; startTime?: string | null; endTime?: string | null; roomId?: number | null },
    components: ComponentInputDto[],
    q: Queryable,
  ) {
    const { rows } = await q.query(
      `INSERT INTO exam_schedules (exam_id, class_subject_id, exam_date, start_time, end_time, room_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [examId, s.classSubjectId, s.examDate ?? null, s.startTime ?? null, s.endTime ?? null, s.roomId ?? null],
    );
    const scheduleId = rows[0].id as number;
    await q.query(
      `INSERT INTO assessment_components (exam_schedule_id, name, component_type, full_marks, pass_marks, credit_hours, sequence)
       SELECT $1, x.name, x.component_type, x.full_marks, x.pass_marks, x.credit_hours, x.sequence
         FROM jsonb_to_recordset($2::jsonb) AS x(name text, component_type text, full_marks numeric, pass_marks numeric, credit_hours numeric, sequence int)`,
      [
        scheduleId,
        JSON.stringify(
          components.map((c, i) => ({
            name: c.name,
            component_type: c.componentType,
            full_marks: c.fullMarks,
            pass_marks: c.passMarks,
            credit_hours: c.creditHours ?? null,
            sequence: c.sequence ?? i,
          })),
        ),
      ],
    );
    return scheduleId;
  }

  async listSchedules(examId: number, classId?: number) {
    const { rows } = await this.db.query(
      `SELECT es.id, es.class_subject_id, cs.class_id, c.name AS class_name, sub.name AS subject_name,
              es.exam_date, es.start_time, es.end_time,
              COALESCE(json_agg(json_build_object(
                  'id', ac.id, 'name', ac.name, 'componentType', ac.component_type,
                  'fullMarks', ac.full_marks, 'passMarks', ac.pass_marks, 'creditHours', ac.credit_hours)
                ORDER BY ac.sequence) FILTER (WHERE ac.id IS NOT NULL), '[]') AS components
         FROM exam_schedules es
         JOIN class_subjects cs ON cs.id = es.class_subject_id
         JOIN classes c ON c.id = cs.class_id
         JOIN subjects sub ON sub.id = cs.subject_id
         LEFT JOIN assessment_components ac ON ac.exam_schedule_id = es.id
        WHERE es.exam_id = $1 AND ($2::int IS NULL OR cs.class_id = $2)
        GROUP BY es.id, cs.id, c.id, sub.id
        ORDER BY c.numeric_level, cs.sequence`,
      [examId, classId ?? null],
    );
    return rowsToCamel(rows);
  }

  async getComponentContext(componentId: number) {
    const { rows } = await this.db.query(
      `SELECT ac.id AS component_id, ac.full_marks, ex.id AS exam_id, ex.is_published AS exam_published,
              cs.id AS class_subject_id, cs.class_id, cs.academic_year_id
         FROM assessment_components ac
         JOIN exam_schedules es ON es.id = ac.exam_schedule_id
         JOIN exams ex ON ex.id = es.exam_id
         JOIN class_subjects cs ON cs.id = es.class_subject_id
        WHERE ac.id = $1`,
      [componentId],
    );
    return rows[0] ? toCamel<ComponentContext>(rows[0]) : null;
  }

  async marksheet(componentId: number, sectionId: number) {
    const { rows } = await this.db.query(
      `SELECT e.id AS enrollment_id, e.roll_no, s.id AS student_id,
              concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
              m.marks_obtained, m.is_absent, m.remarks, m.verified_at
         FROM assessment_components ac
         JOIN exam_schedules es ON es.id = ac.exam_schedule_id
         JOIN class_subjects cs ON cs.id = es.class_subject_id
         JOIN enrollments e ON e.section_id = $2 AND e.status = 'studying'
         JOIN sections sec ON sec.id = e.section_id
         JOIN students s ON s.id = e.student_id
         LEFT JOIN marks m ON m.component_id = ac.id AND m.enrollment_id = e.id
        WHERE ac.id = $1 AND ${TAKES_SUBJECT}
        ORDER BY e.roll_no NULLS LAST, s.first_name`,
      [componentId, sectionId],
    );
    return rowsToCamel(rows);
  }

  async countStudentsTakingComponent(componentId: number, sectionId: number, enrollmentIds: number[]) {
    const { rows } = await this.db.query(
      `SELECT count(*)::int AS n
         FROM assessment_components ac
         JOIN exam_schedules es ON es.id = ac.exam_schedule_id
         JOIN class_subjects cs ON cs.id = es.class_subject_id
         JOIN enrollments e ON e.section_id = $2 AND e.status = 'studying' AND e.id = ANY($3::bigint[])
         JOIN sections sec ON sec.id = e.section_id
        WHERE ac.id = $1 AND ${TAKES_SUBJECT}`,
      [componentId, sectionId, enrollmentIds],
    );
    return rows[0].n as number;
  }

  async countVerified(componentId: number, enrollmentIds: number[]) {
    const { rows } = await this.db.query(
      `SELECT count(*)::int AS n FROM marks WHERE component_id = $1 AND enrollment_id = ANY($2::bigint[]) AND verified_at IS NOT NULL`,
      [componentId, enrollmentIds],
    );
    return rows[0].n as number;
  }

  async upsertMarks(componentId: number, entries: MarkEntry[], enteredBy: number, q: Queryable) {
    const { rowCount } = await q.query(
      `INSERT INTO marks (component_id, enrollment_id, marks_obtained, is_absent, remarks, entered_by)
       SELECT $1, x.enrollment_id, x.marks_obtained, x.is_absent, x.remarks, $2
         FROM jsonb_to_recordset($3::jsonb) AS x(enrollment_id bigint, marks_obtained numeric, is_absent boolean, remarks text)
       ON CONFLICT (component_id, enrollment_id) DO UPDATE SET
          marks_obtained = EXCLUDED.marks_obtained,
          is_absent      = EXCLUDED.is_absent,
          remarks        = EXCLUDED.remarks,
          entered_by     = EXCLUDED.entered_by,
          verified_by    = NULL,   -- changed marks must be verified again
          verified_at    = NULL`,
      [
        componentId,
        enteredBy,
        JSON.stringify(entries.map((e) => ({ enrollment_id: e.enrollmentId, marks_obtained: e.marksObtained, is_absent: e.isAbsent, remarks: e.remarks ?? null }))),
      ],
    );
    return rowCount ?? 0;
  }

  async verifyMarks(examId: number, sectionId: number, classSubjectId: number | null, verifierId: number, q: Queryable) {
    const { rowCount } = await q.query(
      `UPDATE marks m SET verified_by = $4, verified_at = now()
         FROM assessment_components ac, exam_schedules es, enrollments e
        WHERE m.component_id = ac.id AND ac.exam_schedule_id = es.id AND m.enrollment_id = e.id
          AND es.exam_id = $1 AND e.section_id = $2
          AND ($3::int IS NULL OR es.class_subject_id = $3)
          AND m.verified_at IS NULL`,
      [examId, sectionId, classSubjectId, verifierId],
    );
    return rowCount ?? 0;
  }

  async getGradingBands(scaleId: number | null): Promise<GradeBand[]> {
    const { rows } = await this.db.query(
      `SELECT i.min_percent, i.max_percent, i.grade, i.grade_point
         FROM grading_scale_items i JOIN grading_scales g ON g.id = i.grading_scale_id
        WHERE ($1::int IS NOT NULL AND g.id = $1) OR ($1::int IS NULL AND g.is_default)
        ORDER BY i.min_percent DESC`,
      [scaleId],
    );
    return rowsToCamel<GradeBand>(rows);
  }

  async loadResultInputs(examId: number, sectionId: number | null) {
    const { rows } = await this.db.query(
      `SELECT e.id AS enrollment_id, e.section_id, sec.class_id, cs.id AS class_subject_id,
              cs.credit_hours AS subject_credit_hours, ac.id AS component_id, ac.full_marks, ac.pass_marks,
              ac.credit_hours, m.marks_obtained, COALESCE(m.is_absent, false) AS is_absent, (m.id IS NOT NULL) AS has_mark
         FROM exams ex
         JOIN enrollments e ON e.academic_year_id = ex.academic_year_id AND e.status NOT IN ('transferred', 'left')
         JOIN sections sec ON sec.id = e.section_id
         JOIN exam_schedules es ON es.exam_id = ex.id
         JOIN class_subjects cs ON cs.id = es.class_subject_id AND cs.class_id = sec.class_id
         JOIN assessment_components ac ON ac.exam_schedule_id = es.id
         LEFT JOIN marks m ON m.component_id = ac.id AND m.enrollment_id = e.id
        WHERE ex.id = $1 AND ($2::int IS NULL OR e.section_id = $2) AND ${TAKES_SUBJECT}
        ORDER BY e.id, cs.sequence, ac.sequence`,
      [examId, sectionId],
    );
    return rowsToCamel<ResultInputRow>(rows);
  }

  async saveResults(examId: number, results: ProcessedResult[], q: Queryable) {
    const ids = results.map((r) => r.enrollmentId);
    for (const table of ['exam_component_results', 'exam_subject_results', 'exam_results']) {
      await q.query(`DELETE FROM ${table} WHERE exam_id = $1 AND enrollment_id = ANY($2::bigint[])`, [examId, ids]);
    }
    const components = results.flatMap((r) =>
      r.components.map((c) => ({ enrollment_id: r.enrollmentId, component_id: c.componentId, percentage: c.percentage, grade: c.grade, grade_point: c.gradePoint, credit_hours: c.creditHours })),
    );
    const subjects = results.flatMap((r) =>
      r.subjects.map((s) => ({
        enrollment_id: r.enrollmentId, class_subject_id: s.classSubjectId, total_obtained: s.totalObtained, total_full: s.totalFull,
        percentage: s.percentage, grade: s.grade, grade_point: s.gradePoint, is_graded: s.isGraded,
      })),
    );
    const overall = results.map((r) => ({
      enrollment_id: r.enrollmentId, total_obtained: r.totalObtained, total_full: r.totalFull, percentage: r.percentage, gpa: r.gpa,
      final_grade: r.finalGrade, rank_in_section: r.rankInSection, rank_in_class: r.rankInClass, result_status: r.status,
    }));

    await q.query(
      `INSERT INTO exam_component_results (exam_id, enrollment_id, component_id, percentage, grade, grade_point, credit_hours)
       SELECT $1, x.enrollment_id, x.component_id, x.percentage, x.grade, x.grade_point, x.credit_hours
         FROM jsonb_to_recordset($2::jsonb) AS x(enrollment_id bigint, component_id int, percentage numeric, grade text, grade_point numeric, credit_hours numeric)`,
      [examId, JSON.stringify(components)],
    );
    await q.query(
      `INSERT INTO exam_subject_results (exam_id, enrollment_id, class_subject_id, total_obtained, total_full, percentage, grade, grade_point, is_graded)
       SELECT $1, x.enrollment_id, x.class_subject_id, x.total_obtained, x.total_full, x.percentage, x.grade, x.grade_point, x.is_graded
         FROM jsonb_to_recordset($2::jsonb) AS x(enrollment_id bigint, class_subject_id int, total_obtained numeric, total_full numeric,
                                                percentage numeric, grade text, grade_point numeric, is_graded boolean)`,
      [examId, JSON.stringify(subjects)],
    );
    await q.query(
      `INSERT INTO exam_results (exam_id, enrollment_id, total_obtained, total_full, percentage, gpa, final_grade, rank_in_section, rank_in_class, result_status)
       SELECT $1, x.enrollment_id, x.total_obtained, x.total_full, x.percentage, x.gpa, x.final_grade, x.rank_in_section, x.rank_in_class, x.result_status
         FROM jsonb_to_recordset($2::jsonb) AS x(enrollment_id bigint, total_obtained numeric, total_full numeric, percentage numeric, gpa numeric,
                                                final_grade text, rank_in_section smallint, rank_in_class smallint, result_status text)`,
      [examId, JSON.stringify(overall)],
    );
  }

  async setPublished(examId: number, published: boolean, q: Queryable) {
    await q.query(`UPDATE exams SET is_published = $2, published_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`, [examId, published]);
  }

  async listResults(examId: number, sectionId?: number) {
    const { rows } = await this.db.query(
      `SELECT r.enrollment_id, s.id AS student_id, s.admission_no, concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
              c.name AS class_name, sec.name AS section_name, e.roll_no,
              r.total_obtained, r.total_full, r.percentage, r.gpa, r.final_grade, r.rank_in_section, r.rank_in_class, r.result_status
         FROM exam_results r
         JOIN enrollments e ON e.id = r.enrollment_id
         JOIN students s ON s.id = e.student_id
         JOIN sections sec ON sec.id = e.section_id
         JOIN classes c ON c.id = sec.class_id
        WHERE r.exam_id = $1 AND ($2::int IS NULL OR e.section_id = $2)
        ORDER BY c.numeric_level, sec.name, r.rank_in_section NULLS LAST, e.roll_no`,
      [examId, sectionId ?? null],
    );
    return rowsToCamel(rows);
  }

  async reportCard(examId: number, studentId: number) {
    const head = await this.db.query(
      `SELECT ex.id AS exam_id, ex.name AS exam_name, ay.name AS academic_year, ex.is_published,
              s.id AS student_id, s.admission_no, concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
              c.name AS class_name, sec.name AS section_name, e.roll_no, e.symbol_no, e.id AS enrollment_id,
              r.total_obtained, r.total_full, r.percentage, r.gpa, r.final_grade, r.rank_in_section, r.rank_in_class,
              r.result_status, r.teacher_remarks
         FROM exams ex
         JOIN academic_years ay ON ay.id = ex.academic_year_id
         JOIN enrollments e ON e.academic_year_id = ex.academic_year_id AND e.student_id = $2
         JOIN students s ON s.id = e.student_id
         JOIN sections sec ON sec.id = e.section_id
         JOIN classes c ON c.id = sec.class_id
         JOIN exam_results r ON r.exam_id = ex.id AND r.enrollment_id = e.id
        WHERE ex.id = $1`,
      [examId, studentId],
    );
    if (!head.rows[0]) return null;
    const card = toCamel<Record<string, unknown> & { enrollmentId: number }>(head.rows[0]);

    // withheld results show status only (e.g. unpaid fees)
    if (card.resultStatus === 'withheld') {
      return { ...card, gpa: null, finalGrade: null, percentage: null, totalObtained: null, subjects: [] };
    }

    const subjects = await this.db.query(
      `SELECT sr.class_subject_id, sub.code AS subject_code, sub.name AS subject_name, sr.total_obtained, sr.total_full,
              sr.percentage, sr.grade, sr.grade_point, sr.is_graded,
              COALESCE(json_agg(json_build_object(
                  'name', ac.name, 'componentType', ac.component_type, 'fullMarks', ac.full_marks,
                  'marksObtained', m.marks_obtained, 'isAbsent', m.is_absent,
                  'grade', cr.grade, 'gradePoint', cr.grade_point, 'creditHours', cr.credit_hours)
                ORDER BY ac.sequence) FILTER (WHERE ac.id IS NOT NULL), '[]') AS components
         FROM exam_subject_results sr
         JOIN class_subjects cs ON cs.id = sr.class_subject_id
         JOIN subjects sub ON sub.id = cs.subject_id
         JOIN exam_schedules es ON es.exam_id = sr.exam_id AND es.class_subject_id = sr.class_subject_id
         LEFT JOIN assessment_components ac ON ac.exam_schedule_id = es.id
         LEFT JOIN marks m ON m.component_id = ac.id AND m.enrollment_id = sr.enrollment_id
         LEFT JOIN exam_component_results cr ON cr.exam_id = sr.exam_id AND cr.enrollment_id = sr.enrollment_id AND cr.component_id = ac.id
        WHERE sr.exam_id = $1 AND sr.enrollment_id = $2
        GROUP BY sr.id, cs.sequence, sub.id
        ORDER BY cs.sequence, sub.name`,
      [examId, card.enrollmentId],
    );
    return { ...card, subjects: rowsToCamel(subjects.rows) };
  }

  async studentResults(studentId: number, publishedOnly: boolean) {
    const { rows } = await this.db.query(
      `SELECT ex.id AS exam_id, ex.name AS exam_name, ex.exam_type, ex.is_published, ex.published_at,
              ay.name AS academic_year, c.name AS class_name, sec.name AS section_name, r.result_status,
              CASE WHEN r.result_status = 'withheld' THEN NULL ELSE r.percentage END AS percentage,
              CASE WHEN r.result_status = 'withheld' THEN NULL ELSE r.gpa END AS gpa,
              CASE WHEN r.result_status = 'withheld' THEN NULL ELSE r.final_grade END AS final_grade,
              CASE WHEN r.result_status = 'withheld' THEN NULL ELSE r.rank_in_section END AS rank_in_section
         FROM exam_results r
         JOIN enrollments e ON e.id = r.enrollment_id
         JOIN exams ex ON ex.id = r.exam_id
         JOIN academic_years ay ON ay.id = ex.academic_year_id
         JOIN sections sec ON sec.id = e.section_id
         JOIN classes c ON c.id = sec.class_id
        WHERE e.student_id = $1 AND ($2::boolean = false OR ex.is_published)
        ORDER BY ay.start_date DESC, COALESCE(ex.start_date, ex.created_at::date) DESC, ex.id DESC
        LIMIT 100`,
      [studentId, publishedOnly],
    );
    return rows.map((r) => toCamel<Record<string, unknown>>(r));
  }
}
