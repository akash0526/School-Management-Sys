import type { AuthUser } from '../../../shared/auth/types.js';
import type { Tx } from '../../../shared/db/database.js';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave' | 'half_day';

export interface StudentMark {
  enrollmentId: number;
  status: AttendanceStatus;
  remarks?: string | null;
}

export interface StaffMark {
  staffId: number;
  status: AttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  remarks?: string | null;
}

export interface AttendanceRepository {
  countActiveEnrollmentsInSection(sectionId: number, enrollmentIds: number[]): Promise<number>;
  upsertStudentMarks(date: string, periodId: number | null, marks: StudentMark[], markedBy: number, tx: Tx): Promise<number>;
  sectionRoster(sectionId: number, date: string, periodId: number | null): Promise<Record<string, unknown>[]>;
  studentRecords(studentId: number, from: string, to: string): Promise<Record<string, unknown>[]>;
  studentSummary(studentId: number, academicYearId?: number): Promise<Record<string, unknown>[]>;
  upsertStaffMarks(date: string, marks: StaffMark[], tx: Tx): Promise<number>;
  listStaffAttendance(date: string): Promise<Record<string, unknown>[]>;
}

// ---------------- Ports to other modules ----------------
export interface AcademicLookup {
  getSection(id: number): Promise<{ id: number; academicYearId: number } | null>;
  isTeacherAssigned(staffId: number, sectionId: number, classSubjectId?: number): Promise<boolean>;
  isClassTeacher(staffId: number, sectionId: number): Promise<boolean>;
  isHoliday(date: string): Promise<boolean>;
}

export interface StudentAccess {
  assertCanViewStudent(user: AuthUser, studentId: number): Promise<void>;
}
