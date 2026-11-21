import type { AuthUser } from '../../../shared/auth/types.js';
import { hasAnyPermission, hasPermission } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import type { EventBus } from '../../../shared/events/eventBus.js';
import { badRequest, conflict, forbidden, notFound } from '../../../shared/errors.js';
import type {
  AcademicLookup,
  ComponentInputDto,
  ExamInput,
  ExamsRepository,
  MarkEntry,
  ProcessedResult,
  StudentAccess,
} from './exams.ports.js';
import { computeStudentResult, describeGaps, gradingScaleGaps, rank } from './grading.js';

/** BUSINESS LAYER — exams, marks entry, result processing, publishing. */
export class ExamsService {
  constructor(
    private readonly repo: ExamsRepository,
    private readonly tx: TransactionRunner,
    private readonly academic: AcademicLookup,
    private readonly studentAccess: StudentAccess,
    private readonly events: EventBus,
  ) {}

  // ---------------- exams & schedules ----------------
  listExams(academicYearId?: number) {
    return this.repo.listExams(academicYearId);
  }

  async getExam(id: number) {
    const exam = await this.repo.getExam(id);
    if (!exam) throw notFound('Exam');
    return { ...exam, schedules: await this.repo.listSchedules(id) };
  }

  createExam(actor: AuthUser, input: ExamInput) {
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw badRequest('End date before start date');
    return this.tx.transaction(actor.userId, (t) => this.repo.createExam(input, t));
  }

  async updateExam(actor: AuthUser, id: number, input: Partial<ExamInput>) {
    const exam = await this.repo.getExam(id);
    if (!exam) throw notFound('Exam');
    if (exam.isPublished) throw conflict('Unpublish the exam before editing it');
    return this.tx.transaction(actor.userId, (t) => this.repo.updateExam(id, input, t));
  }

  async addSchedule(
    actor: AuthUser,
    examId: number,
    input: { classSubjectId: number; examDate?: string | null; startTime?: string | null; endTime?: string | null; roomId?: number | null; components: ComponentInputDto[] },
  ) {
    const exam = await this.repo.getExam(examId);
    if (!exam) throw notFound('Exam');
    if (exam.isPublished) throw conflict('Exam is already published');
    const cs = await this.academic.getClassSubject(input.classSubjectId);
    if (!cs) throw notFound('Class subject');
    if (cs.academicYearId !== exam.academicYearId) throw badRequest('Subject belongs to a different academic year than the exam');
    const names = new Set(input.components.map((c) => c.name.toLowerCase()));
    if (names.size !== input.components.length) throw badRequest('Component names must be unique');
    for (const c of input.components) if (c.passMarks > c.fullMarks) throw badRequest(`Pass marks exceed full marks in "${c.name}"`);

    const { components, ...schedule } = input;
    const scheduleId = await this.tx.transaction(actor.userId, (t) => this.repo.createSchedule(examId, schedule, components, t));
    // return the full schedule so the client gets component ids for marks entry
    const created = (await this.repo.listSchedules(examId)).find((x) => x.id === scheduleId);
    return created ?? { id: scheduleId };
  }

  listSchedules(examId: number, classId?: number) {
    return this.repo.listSchedules(examId, classId);
  }

  // ---------------- marks ----------------
  /** marks.enter_any -> anything; marks.enter -> only subjects you teach in that section. */
  private async assertCanEnterMarks(actor: AuthUser, sectionId: number, classSubjectId: number) {
    if (hasPermission(actor, 'marks.enter_any')) return;
    if (!hasPermission(actor, 'marks.enter') || !actor.staffId) throw forbidden();
    if (!(await this.academic.isTeacherAssigned(actor.staffId, sectionId, classSubjectId))) {
      throw forbidden('You do not teach this subject in this section');
    }
  }

  private async componentInSection(componentId: number, sectionId: number) {
    const ctx = await this.repo.getComponentContext(componentId);
    if (!ctx) throw notFound('Assessment component');
    const section = await this.academic.getSection(sectionId);
    if (!section) throw notFound('Section');
    if (section.academicYearId !== ctx.academicYearId || section.classId !== ctx.classId) {
      throw badRequest('This exam paper is not for that section');
    }
    return ctx;
  }

  async marksheet(actor: AuthUser, componentId: number, sectionId: number) {
    const ctx = await this.componentInSection(componentId, sectionId);
    if (!hasAnyPermission(actor, ['marks.approve', 'results.view'])) await this.assertCanEnterMarks(actor, sectionId, ctx.classSubjectId);
    return { component: ctx, items: await this.repo.marksheet(componentId, sectionId) };
  }

  async enterMarks(actor: AuthUser, componentId: number, sectionId: number, entries: MarkEntry[]) {
    const ctx = await this.componentInSection(componentId, sectionId);
    await this.assertCanEnterMarks(actor, sectionId, ctx.classSubjectId);
    if (ctx.examPublished) throw conflict('Results are published — unpublish before changing marks');

    const ids = entries.map((e) => e.enrollmentId);
    if (new Set(ids).size !== ids.length) throw badRequest('Duplicate enrollmentId in entries');
    for (const e of entries) {
      if (e.isAbsent && e.marksObtained !== null) throw badRequest(`Enrollment ${e.enrollmentId}: absent students cannot have marks`);
      if (!e.isAbsent && e.marksObtained === null) throw badRequest(`Enrollment ${e.enrollmentId}: marks are required unless absent`);
      if (e.marksObtained !== null && e.marksObtained > ctx.fullMarks) {
        throw badRequest(`Enrollment ${e.enrollmentId}: marks exceed full marks (${ctx.fullMarks})`);
      }
    }
    if ((await this.repo.countStudentsTakingComponent(componentId, sectionId, ids)) !== ids.length) {
      throw badRequest('Some students are not in this section or do not take this subject');
    }
    if (!hasPermission(actor, 'marks.approve') && (await this.repo.countVerified(componentId, ids)) > 0) {
      throw conflict('Some marks are already verified — ask an approver to change them');
    }
    const saved = await this.tx.transaction(actor.userId, (t) => this.repo.upsertMarks(componentId, entries, actor.userId, t));
    return { saved };
  }

  async verifyMarks(actor: AuthUser, examId: number, sectionId: number, classSubjectId: number | null) {
    const exam = await this.repo.getExam(examId);
    if (!exam) throw notFound('Exam');
    const verified = await this.tx.transaction(actor.userId, (t) => this.repo.verifyMarks(examId, sectionId, classSubjectId, actor.userId, t));
    return { verified };
  }

  // ---------------- results ----------------
  async processResults(actor: AuthUser, examId: number, opts: { sectionId: number | null; force: boolean }) {
    const exam = await this.repo.getExam(examId);
    if (!exam) throw notFound('Exam');
    if (exam.isPublished) throw conflict('Unpublish the exam before re-processing results');

    const [bands, rows] = await Promise.all([this.repo.getGradingBands(exam.gradingScaleId), this.repo.loadResultInputs(examId, opts.sectionId)]);
    if (!bands.length) throw badRequest('No grading scale configured');

    // Check the scale BEFORE computing anything. A gap would otherwise throw inside the
    // per-student loop and abort the whole exam with a 500 that names no fix.
    const gaps = gradingScaleGaps(bands);
    if (gaps.length) {
      throw badRequest(
        `The grading scale does not cover every mark: ${describeGaps(gaps)}. ` +
          'Fix the grading scale, then process results again.',
        { gaps, scaleId: exam.gradingScaleId },
      );
    }

    if (!rows.length) throw badRequest('Nothing to process — no students or exam papers found');

    const missing = rows.filter((r) => !r.hasMark);
    if (missing.length && !opts.force) {
      throw badRequest(`${missing.length} mark(s) not entered yet. Enter them, or re-run with force=true to treat them as absent.`, {
        missing: missing.slice(0, 50).map((m) => ({ enrollmentId: m.enrollmentId, componentId: m.componentId })),
      });
    }

    // group by enrollment and compute
    const byEnrollment = new Map<number, typeof rows>();
    for (const r of rows) byEnrollment.set(r.enrollmentId, [...(byEnrollment.get(r.enrollmentId) ?? []), r]);

    const results: (ProcessedResult & { sectionId: number; classId: number })[] = [];
    for (const [enrollmentId, comps] of byEnrollment) {
      const res = computeStudentResult(
        comps.map((c) => ({
          componentId: c.componentId,
          classSubjectId: c.classSubjectId,
          fullMarks: c.fullMarks,
          passMarks: c.passMarks,
          creditHours: c.creditHours,
          subjectCreditHours: c.subjectCreditHours,
          marks: c.hasMark ? c.marksObtained : null,
          isAbsent: c.hasMark ? c.isAbsent : true,
        })),
        bands,
      );
      results.push({ enrollmentId, sectionId: comps[0].sectionId, classId: comps[0].classId, ...res, rankInSection: null, rankInClass: null });
    }

    // ranks
    for (const key of ['sectionId', 'classId'] as const) {
      const groups = new Map<number, typeof results>();
      for (const r of results) groups.set(r[key], [...(groups.get(r[key]) ?? []), r]);
      for (const group of groups.values()) {
        const ranks = rank(group);
        for (const r of group) {
          if (key === 'sectionId') r.rankInSection = ranks.get(r.enrollmentId) ?? null;
          else r.rankInClass = ranks.get(r.enrollmentId) ?? null;
        }
      }
    }
    // NOTE: class rank is only complete when processing the whole class (no sectionId filter)

    await this.tx.transaction(actor.userId, (t) => this.repo.saveResults(examId, results, t));
    return {
      processed: results.length,
      graded: results.filter((r) => r.status === 'graded').length,
      notGraded: results.filter((r) => r.status === 'not_graded').length,
      absent: results.filter((r) => r.status === 'absent').length,
      treatedAsAbsent: missing.length,
    };
  }

  async setPublished(actor: AuthUser, examId: number, published: boolean) {
    const exam = await this.repo.getExam(examId);
    if (!exam) throw notFound('Exam');
    await this.tx.transaction(actor.userId, (t) => this.repo.setPublished(examId, published, t));
    this.events.publish('results.published', { examId, published, actorUserId: actor.userId });
  }

  /**
   * Withhold or release results (unpaid fees, a discipline case, a mark under review).
   *
   * A withheld result is deliberately visible to the family as "result withheld" with no
   * marks — see reportCard/listResults, which null out the numbers — so the office does
   * not have to lie about why the report card is missing.
   *
   * Allowed after publishing: withholding is usually BECAUSE of a published result.
   */
  async setWithheld(actor: AuthUser, examId: number, body: { enrollmentIds?: number[]; sectionId?: number; withheld: boolean }) {
    const exam = await this.repo.getExam(examId);
    if (!exam) throw notFound('Exam');

    let ids: number[] | null = body.enrollmentIds?.length ? body.enrollmentIds : null;
    if (!ids && body.sectionId) {
      // conveniences: "withhold this whole section" — resolve it to enrollment ids so the
      // response can report exactly what changed
      ids = await this.repo.enrollmentIdsForSection(exam.academicYearId, body.sectionId);
      if (!ids.length) throw badRequest('That section has no enrolled students in this exam year');
    }

    const changed = await this.tx.transaction(actor.userId, (t) =>
      this.repo.setWithheld(examId, ids, body.withheld, t),
    );
    if (!changed.length) {
      throw conflict(
        body.withheld
          ? 'No results to withhold — process the results first'
          : 'No withheld results matched; nothing to release',
      );
    }
    this.events.publish('results.withheld', { examId, withheld: body.withheld, enrollmentIds: changed, actorUserId: actor.userId });
    return { withheld: body.withheld, updated: changed.length, enrollmentIds: changed };
  }

  listResults(examId: number, sectionId?: number) {
    return this.repo.listResults(examId, sectionId);
  }

  /** Staff with results.view see any report card; students/parents only their own, and only after publishing. */
  async reportCard(actor: AuthUser, examId: number, studentId: number) {
    const exam = await this.repo.getExam(examId);
    if (!exam) throw notFound('Exam');
    if (!hasPermission(actor, 'results.view')) {
      await this.studentAccess.assertCanViewStudent(actor, studentId);
      if (!exam.isPublished) throw forbidden('Results are not published yet');
    }
    const card = await this.repo.reportCard(examId, studentId);
    if (!card) throw notFound('Result');
    return card;
  }

  /** Exam history for one student: staff with results.view see everything; students/parents only their own, published exams. */
  async studentResults(actor: AuthUser, studentId: number) {
    const isStaff = hasPermission(actor, 'results.view');
    if (!isStaff) await this.studentAccess.assertCanViewStudent(actor, studentId);
    return this.repo.studentResults(studentId, !isStaff);
  }
}
