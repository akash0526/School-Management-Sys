import type { Tx } from '../../../shared/db/database.js';

export interface EnrollmentRecord {
  id: number;
  studentId: number;
  academicYearId: number;
  sectionId: number;
  rollNo: number | null;
  symbolNo: string | null;
  status: string;
}

export interface EnrollmentPatch {
  rollNo?: number | null;
  symbolNo?: string | null;
  registrationNo?: string | null;
  status?: 'studying' | 'promoted' | 'repeated' | 'transferred' | 'left' | 'graduated';
  remarks?: string | null;
}

export interface EnrollmentRepository {
  list(f: { sectionId?: number; academicYearId?: number; studentId?: number; status?: string }): Promise<Record<string, unknown>[]>;
  findById(id: number, tx?: Tx): Promise<EnrollmentRecord | null>;
  create(e: { studentId: number; academicYearId: number; sectionId: number; rollNo?: number | null; symbolNo?: string | null; registrationNo?: string | null }, tx: Tx): Promise<EnrollmentRecord>;
  update(id: number, patch: EnrollmentPatch, tx: Tx): Promise<EnrollmentRecord | null>;
  setStatus(id: number, status: string, tx: Tx): Promise<void>;
  listSubjects(enrollmentId: number): Promise<Record<string, unknown>[]>;
  replaceSubjects(enrollmentId: number, classSubjectIds: number[], tx: Tx): Promise<void>;
  assignRollNumbersAlphabetically(sectionId: number, tx: Tx): Promise<number>;
  listActiveBySection(sectionId: number): Promise<Array<{ enrollmentId: number; studentId: number; rollNo: number | null; studentName: string }>>;
}

// ---------------- Ports to other modules (wired by container) ----------------
export interface AcademicLookup {
  getSection(id: number): Promise<{ id: number; academicYearId: number; classId: number; streamId: number | null } | null>;
  getClassSubject(id: number): Promise<{ id: number; academicYearId: number; classId: number; streamId: number | null; isOptional: boolean; optionalGroup: string | null } | null>;
}

export interface StudentLookup {
  getStudentStatus(studentId: number): Promise<string | null>;
}
