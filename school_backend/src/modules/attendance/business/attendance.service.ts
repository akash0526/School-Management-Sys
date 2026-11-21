import type { AuthUser } from '../../../shared/auth/types.js';
import { hasPermission } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import type { EventBus } from '../../../shared/events/eventBus.js';
import { badRequest, forbidden, notFound } from '../../../shared/errors.js';
import { todayInNepal } from '../../../shared/time.js';
import type { AcademicLookup, AttendanceRepository, StaffMark, StudentAccess, StudentMark } from './attendance.ports.js';

/** BUSINESS LAYER — attendance rules. */
export class AttendanceService {
  constructor(
    private readonly repo: AttendanceRepository,
    private readonly tx: TransactionRunner,
    private readonly academic: AcademicLookup,
    private readonly studentAccess: StudentAccess,
    private readonly events: EventBus,
  ) {}

  /** attendance.mark_any -> any section; attendance.mark -> only sections you teach or are class teacher of. */
  private async assertCanMark(actor: AuthUser, sectionId: number) {
    if (hasPermission(actor, 'attendance.mark_any')) return;
    if (!hasPermission(actor, 'attendance.mark') || !actor.staffId) throw forbidden();
    const allowed =
      (await this.academic.isClassTeacher(actor.staffId, sectionId)) ||
      (await this.academic.isTeacherAssigned(actor.staffId, sectionId));
    if (!allowed) throw forbidden('You are not assigned to this section');
  }

  private async assertCanViewSection(actor: AuthUser, sectionId: number) {
    if (hasPermission(actor, 'attendance.view')) return;
    await this.assertCanMark(actor, sectionId);
  }

  async markSection(actor: AuthUser, sectionId: number, input: { date: string; periodId?: number | null; records: StudentMark[]; allowHoliday?: boolean }) {
    await this.assertCanMark(actor, sectionId);
    if (!(await this.academic.getSection(sectionId))) throw notFound('Section');
    if (input.date > todayInNepal()) throw badRequest('Cannot mark attendance for a future date');
    if (await this.academic.isHoliday(input.date)) {
      if (!input.allowHoliday || !hasPermission(actor, 'attendance.mark_any')) {
        throw badRequest('This date is a holiday in the school calendar');
      }
    }
    const ids = [...new Set(input.records.map((r) => r.enrollmentId))];
    if (ids.length !== input.records.length) throw badRequest('Duplicate enrollmentId in records');
    const valid = await this.repo.countActiveEnrollmentsInSection(sectionId, ids);
    if (valid !== ids.length) throw badRequest('Some students are not actively enrolled in this section');

    const saved = await this.tx.transaction(actor.userId, (t) =>
      this.repo.upsertStudentMarks(input.date, input.periodId ?? null, input.records, actor.userId, t),
    );

    const absent = input.records.filter((r) => r.status === 'absent').map((r) => r.enrollmentId);
    if (absent.length) {
      // e.g. a future notifications module subscribes and sends SMS to guardians
      this.events.publish('attendance.absent', { date: input.date, sectionId, enrollmentIds: absent, actorUserId: actor.userId });
    }
    return { saved, absent: absent.length };
  }

  async sectionRoster(actor: AuthUser, sectionId: number, date: string, periodId: number | null) {
    await this.assertCanViewSection(actor, sectionId);
    return this.repo.sectionRoster(sectionId, date, periodId);
  }

  async studentRecords(actor: AuthUser, studentId: number, from: string, to: string) {
    await this.studentAccess.assertCanViewStudent(actor, studentId);
    if (to < from) throw badRequest('"to" must not be before "from"');
    return this.repo.studentRecords(studentId, from, to);
  }

  async studentSummary(actor: AuthUser, studentId: number, academicYearId?: number) {
    await this.studentAccess.assertCanViewStudent(actor, studentId);
    return this.repo.studentSummary(studentId, academicYearId);
  }

  async markStaff(actor: AuthUser, date: string, records: StaffMark[]) {
    if (date > todayInNepal()) throw badRequest('Cannot mark attendance for a future date');
    for (const r of records) {
      if (r.checkIn && r.checkOut && r.checkOut <= r.checkIn) throw badRequest(`Check-out must be after check-in (staff ${r.staffId})`);
    }
    const saved = await this.tx.transaction(actor.userId, (t) => this.repo.upsertStaffMarks(date, records, t));
    return { saved };
  }

  listStaff(date: string) {
    return this.repo.listStaffAttendance(date);
  }
}
