import type { AuthUser } from '../../../shared/auth/types.js';
import type { Tx } from '../../../shared/db/database.js';
import type { ComponentResult, GradeBand, SubjectResult } from './grading.js';

export interface ExamRecord {
  id: number;
  academicYearId: number;
  name: string;
  isPublished: boolean;
  gradingScaleId: number | null;
}

export interface ExamInput {
  academicYearId: number;
  termId?: number | null;
  name: string;
  examType: 'unit' | 'terminal' | 'final' | 'pre_board' | 'entrance';
  gradingScaleId?: number | null;
  weightageInFinal?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface ComponentInputDto {
  name: string;
  componentType: 'theory' | 'practical' | 'internal' | 'project' | 'oral' | 'cas';
  fullMarks: number;
  passMarks: number;
  creditHours?: number | null;
  sequence?: number;
}

export interface ComponentContext {
  componentId: number;
  fullMarks: number;
  examId: number;
  examPublished: boolean;
  classSubjectId: number;
  classId: number;
  academicYearId: number;
}

export interface MarkEntry {
  enrollmentId: number;
  marksObtained: number | null;
  isAbsent: boolean;
  remarks?: string | null;
}

/** One row per (enrollment, component) used for result calculation. */
export interface ResultInputRow {
  enrollmentId: number;
  sectionId: number;
  classId: number;
  classSubjectId: number;
  subjectCreditHours: number | null;
  componentId: number;
  fullMarks: number;
  passMarks: number;
  creditHours: number | null;
  marksObtained: number | null;
  isAbsent: boolean;
  hasMark: boolean;
}

export interface ProcessedResult {
  enrollmentId: number;
  components: ComponentResult[];
  subjects: SubjectResult[];
  totalObtained: number;
  totalFull: number;
  percentage: number;
  gpa: number | null;
  finalGrade: string;
  status: 'graded' | 'not_graded' | 'absent';
  rankInSection: number | null;
  rankInClass: number | null;
}

export interface ExamsRepository {
  listExams(academicYearId?: number): Promise<Record<string, unknown>[]>;
  getExam(id: number, tx?: Tx): Promise<ExamRecord | null>;
  createExam(input: ExamInput, tx: Tx): Promise<Record<string, unknown>>;
  updateExam(id: number, input: Partial<ExamInput>, tx: Tx): Promise<Record<string, unknown> | null>;
  createSchedule(
    examId: number,
    s: { classSubjectId: number; examDate?: string | null; startTime?: string | null; endTime?: string | null; roomId?: number | null },
    components: ComponentInputDto[],
    tx: Tx,
  ): Promise<number>;
  listSchedules(examId: number, classId?: number): Promise<Record<string, unknown>[]>;
  getComponentContext(componentId: number): Promise<ComponentContext | null>;
  marksheet(componentId: number, sectionId: number): Promise<Record<string, unknown>[]>;
  countStudentsTakingComponent(componentId: number, sectionId: number, enrollmentIds: number[]): Promise<number>;
  countVerified(componentId: number, enrollmentIds: number[]): Promise<number>;
  upsertMarks(componentId: number, entries: MarkEntry[], enteredBy: number, tx: Tx): Promise<number>;
  verifyMarks(examId: number, sectionId: number, classSubjectId: number | null, verifierId: number, tx: Tx): Promise<number>;
  getGradingBands(scaleId: number | null): Promise<GradeBand[]>;
  loadResultInputs(examId: number, sectionId: number | null): Promise<ResultInputRow[]>;
  saveResults(examId: number, results: ProcessedResult[], tx: Tx): Promise<void>;
  setPublished(examId: number, published: boolean, tx: Tx): Promise<void>;
  setWithheld(examId: number, enrollmentIds: number[] | null, withheld: boolean, tx: Tx): Promise<number[]>;
  enrollmentIdsForSection(academicYearId: number, sectionId: number): Promise<number[]>;
  listResults(examId: number, sectionId?: number): Promise<Record<string, unknown>[]>;
  reportCard(examId: number, studentId: number): Promise<Record<string, unknown> | null>;
  /** One row per exam the student has a processed result for; publishedOnly hides unpublished exams. */
  studentResults(studentId: number, publishedOnly: boolean): Promise<Record<string, unknown>[]>;
}

// ---------------- Ports to other modules ----------------
export interface AcademicLookup {
  getClassSubject(id: number): Promise<{ id: number; academicYearId: number } | null>;
  getSection(id: number): Promise<{ id: number; academicYearId: number; classId: number } | null>;
  isTeacherAssigned(staffId: number, sectionId: number, classSubjectId?: number): Promise<boolean>;
}

export interface StudentAccess {
  assertCanViewStudent(user: AuthUser, studentId: number): Promise<void>;
}
