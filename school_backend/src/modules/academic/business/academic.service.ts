import type { AuthUser } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import { badRequest, notFound } from '../../../shared/errors.js';
import type { AcademicRepository } from './academic.ports.js';

/** BUSINESS LAYER — academic structure rules. */
export class AcademicService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly tx: TransactionRunner,
  ) {}

  // ---------------- years & terms ----------------
  listYears() {
    return this.repo.listYears();
  }

  createYear(actor: AuthUser, y: { name: string; startDate: string; endDate: string }) {
    if (y.endDate <= y.startDate) throw badRequest('End date must be after start date');
    return this.tx.transaction(actor.userId, (t) => this.repo.createYear(y, t));
  }

  async setCurrentYear(actor: AuthUser, id: number) {
    const ok = await this.tx.transaction(actor.userId, (t) => this.repo.setCurrentYear(id, t));
    if (!ok) throw notFound('Academic year');
  }

  listTerms(yearId: number) {
    return this.repo.listTerms(yearId);
  }

  async createTerm(actor: AuthUser, t: { academicYearId: number; name: string; sequence: number; startDate: string; endDate: string }) {
    const year = await this.repo.getYear(t.academicYearId);
    if (!year) throw notFound('Academic year');
    if (t.startDate < year.startDate || t.endDate > year.endDate || t.endDate < t.startDate) {
      throw badRequest('Term dates must fall inside the academic year');
    }
    return this.tx.transaction(actor.userId, (tx) => this.repo.createTerm(t, tx));
  }

  // ---------------- structure ----------------
  listClasses() {
    return this.repo.listClasses();
  }
  listStreams() {
    return this.repo.listStreams();
  }
  listRooms() {
    return this.repo.listRooms();
  }

  async listSections(f: { academicYearId?: number; classId?: number }) {
    return this.repo.listSections({ ...f, academicYearId: f.academicYearId ?? (await this.repo.getCurrentYearId()) ?? undefined });
  }

  createSection(actor: AuthUser, s: Parameters<AcademicRepository['createSection']>[0]) {
    return this.tx.transaction(actor.userId, (t) => this.repo.createSection(s, t));
  }

  async updateSection(actor: AuthUser, id: number, s: Parameters<AcademicRepository['updateSection']>[1]) {
    const row = await this.tx.transaction(actor.userId, (t) => this.repo.updateSection(id, s, t));
    if (!row) throw notFound('Section');
    return row;
  }

  listSubjects() {
    return this.repo.listSubjects();
  }

  createSubject(actor: AuthUser, s: Parameters<AcademicRepository['createSubject']>[0]) {
    return this.tx.transaction(actor.userId, (t) => this.repo.createSubject(s, t));
  }

  async listClassSubjects(f: { academicYearId?: number; classId?: number; streamId?: number }) {
    const yearId = f.academicYearId ?? (await this.repo.getCurrentYearId());
    if (!yearId) throw badRequest('No current academic year is set');
    return this.repo.listClassSubjects({ ...f, academicYearId: yearId });
  }

  createClassSubject(actor: AuthUser, c: Parameters<AcademicRepository['createClassSubject']>[0]) {
    if (c.isOptional && !c.optionalGroup) throw badRequest('Optional subjects need an optionalGroup (e.g. "Optional I")');
    return this.tx.transaction(actor.userId, (t) => this.repo.createClassSubject(c, t));
  }

  listTeacherAssignments(f: { academicYearId?: number; staffId?: number; sectionId?: number }) {
    return this.repo.listTeacherAssignments(f);
  }

  /** The subject must be taught in the section's class/stream/year. */
  async createTeacherAssignment(actor: AuthUser, a: { sectionId: number; classSubjectId: number; staffId: number }) {
    const section = await this.repo.getSection(a.sectionId);
    if (!section) throw notFound('Section');
    const cs = await this.repo.getClassSubject(a.classSubjectId);
    if (!cs) throw notFound('Class subject');
    if (cs.academicYearId !== section.academicYearId || cs.classId !== section.classId || (cs.streamId !== null && cs.streamId !== section.streamId)) {
      throw badRequest("This subject is not taught in that section's class/stream/year");
    }
    return this.tx.transaction(actor.userId, (t) =>
      this.repo.createTeacherAssignment({ ...a, academicYearId: section.academicYearId }, t),
    );
  }

  async deleteTeacherAssignment(actor: AuthUser, id: number) {
    const ok = await this.tx.transaction(actor.userId, (t) => this.repo.deleteTeacherAssignment(id, t));
    if (!ok) throw notFound('Teacher assignment');
  }

  async listCalendar(yearId?: number) {
    const id = yearId ?? (await this.repo.getCurrentYearId());
    if (!id) throw badRequest('No current academic year is set');
    return this.repo.listCalendar(id);
  }

  async createCalendarEntry(actor: AuthUser, e: Parameters<AcademicRepository['createCalendarEntry']>[0]) {
    const year = await this.repo.getYear(e.academicYearId);
    if (!year) throw notFound('Academic year');
    if (e.endDate < e.startDate) throw badRequest('End date must not be before start date');
    return this.tx.transaction(actor.userId, (t) => this.repo.createCalendarEntry(e, t));
  }
}
