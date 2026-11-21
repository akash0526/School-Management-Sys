import type { AuthUser } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import { badRequest, notFound } from '../../../shared/errors.js';
import type { AcademicLookup, EnrollmentPatch, EnrollmentRepository, StudentLookup } from './enrollment.ports.js';

/** BUSINESS LAYER — enrollment, optional subjects, roll numbers, promotion. */
export class EnrollmentService {
  constructor(
    private readonly repo: EnrollmentRepository,
    private readonly tx: TransactionRunner,
    private readonly academic: AcademicLookup,
    private readonly students: StudentLookup,
  ) {}

  list(f: { sectionId?: number; academicYearId?: number; studentId?: number; status?: string }) {
    if (!f.sectionId && !f.academicYearId && !f.studentId) throw badRequest('Filter by sectionId, academicYearId or studentId');
    return this.repo.list(f);
  }

  async get(id: number) {
    const e = await this.repo.findById(id);
    if (!e) throw notFound('Enrollment');
    return { ...e, subjects: await this.repo.listSubjects(id) };
  }

  async enroll(actor: AuthUser, input: { studentId: number; sectionId: number; rollNo?: number | null; symbolNo?: string | null; registrationNo?: string | null }) {
    const status = await this.students.getStudentStatus(input.studentId);
    if (!status) throw notFound('Student');
    if (status !== 'active') throw badRequest(`Cannot enroll a student whose status is "${status}"`);
    const section = await this.academic.getSection(input.sectionId);
    if (!section) throw notFound('Section');
    // UNIQUE(student, year) in the DB blocks double enrollment in the same year
    return this.tx.transaction(actor.userId, (t) => this.repo.create({ ...input, academicYearId: section.academicYearId }, t));
  }

  async update(actor: AuthUser, id: number, patch: EnrollmentPatch) {
    const e = await this.tx.transaction(actor.userId, (t) => this.repo.update(id, patch, t));
    if (!e) throw notFound('Enrollment');
    return e;
  }

  /** Replace the optional subjects a student has chosen (max one per optional group). */
  async setOptionalSubjects(actor: AuthUser, enrollmentId: number, classSubjectIds: number[]) {
    const e = await this.repo.findById(enrollmentId);
    if (!e) throw notFound('Enrollment');
    const groups = new Set<string>();
    for (const csId of new Set(classSubjectIds)) {
      const cs = await this.academic.getClassSubject(csId);
      if (!cs) throw notFound(`Class subject ${csId}`);
      if (!cs.isOptional) throw badRequest(`Class subject ${csId} is compulsory — only optional subjects are chosen`);
      if (groups.has(cs.optionalGroup ?? '')) throw badRequest(`Only one subject can be chosen from group "${cs.optionalGroup}"`);
      groups.add(cs.optionalGroup ?? '');
    }
    // the DB trigger also verifies class/stream/year match
    await this.tx.transaction(actor.userId, (t) => this.repo.replaceSubjects(enrollmentId, [...new Set(classSubjectIds)], t));
    return this.repo.listSubjects(enrollmentId);
  }

  async assignRollNumbers(actor: AuthUser, sectionId: number) {
    if (!(await this.academic.getSection(sectionId))) throw notFound('Section');
    const count = await this.tx.transaction(actor.userId, (t) => this.repo.assignRollNumbersAlphabetically(sectionId, t));
    return { assigned: count };
  }

  /**
   * Promote (or hold back) students into a section of a LATER academic year.
   * Old enrollments keep their history; new rows are created.
   */
  async promote(actor: AuthUser, input: { enrollmentIds: number[]; targetSectionId: number; outcome: 'promoted' | 'repeated' }) {
    const target = await this.academic.getSection(input.targetSectionId);
    if (!target) throw notFound('Target section');

    return this.tx.transaction(actor.userId, async (t) => {
      const created: number[] = [];
      for (const id of new Set(input.enrollmentIds)) {
        const e = await this.repo.findById(id, t);
        if (!e) throw notFound(`Enrollment ${id}`);
        if (e.status !== 'studying') throw badRequest(`Enrollment ${id} is already "${e.status}"`);
        if (e.academicYearId === target.academicYearId) throw badRequest('Target section must be in a different academic year');
        const source = await this.academic.getSection(e.sectionId);
        if (input.outcome === 'repeated' && source?.classId !== target.classId) {
          throw badRequest('A repeating student must go to a section of the same class');
        }
        await this.repo.setStatus(id, input.outcome, t);
        const next = await this.repo.create({ studentId: e.studentId, academicYearId: target.academicYearId, sectionId: target.id }, t);
        created.push(next.id);
      }
      return { createdEnrollmentIds: created };
    });
  }
}
