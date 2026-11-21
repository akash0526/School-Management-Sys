import type { Tx } from '../../../shared/db/database.js';

export interface SectionInfo {
  id: number;
  academicYearId: number;
  classId: number;
  streamId: number | null;
  name: string;
  classTeacherId: number | null;
}

export type Row = Record<string, unknown>;

export interface ClassSubjectInfo {
  id: number;
  academicYearId: number;
  classId: number;
  streamId: number | null;
  isOptional: boolean;
  optionalGroup: string | null;
}

export interface AcademicRepository {
  // years & terms
  listYears(): Promise<Row[]>;
  createYear(y: { name: string; startDate: string; endDate: string }, tx?: Tx): Promise<Row>;
  setCurrentYear(id: number, tx: Tx): Promise<boolean>;
  getCurrentYearId(): Promise<number | null>;
  listTerms(yearId: number): Promise<Row[]>;
  createTerm(t: { academicYearId: number; name: string; sequence: number; startDate: string; endDate: string }, tx?: Tx): Promise<Row>;
  getYear(id: number): Promise<{ id: number; startDate: string; endDate: string } | null>;

  // structure
  listClasses(): Promise<Row[]>;
  listStreams(): Promise<Row[]>;
  listRooms(): Promise<Row[]>;

  listSections(f: { academicYearId?: number; classId?: number }): Promise<Row[]>;
  getSection(id: number): Promise<SectionInfo | null>;
  createSection(s: { academicYearId: number; classId: number; streamId?: number | null; name: string; classTeacherId?: number | null; roomId?: number | null; capacity?: number | null }, tx?: Tx): Promise<Row>;
  updateSection(id: number, s: { name?: string; classTeacherId?: number | null; roomId?: number | null; capacity?: number | null; streamId?: number | null }, tx?: Tx): Promise<Row | null>;

  listSubjects(): Promise<Row[]>;
  createSubject(s: { code: string; name: string; nameNp?: string | null; hasPractical?: boolean }, tx?: Tx): Promise<Row>;

  listClassSubjects(f: { academicYearId: number; classId?: number; streamId?: number }): Promise<Row[]>;
  createClassSubject(c: { academicYearId: number; classId: number; streamId?: number | null; subjectId: number; creditHours?: number | null; isOptional?: boolean; optionalGroup?: string | null; sequence?: number }, tx?: Tx): Promise<Row>;
  getClassSubject(id: number): Promise<ClassSubjectInfo | null>;

  listTeacherAssignments(f: { academicYearId?: number; staffId?: number; sectionId?: number }): Promise<Row[]>;
  createTeacherAssignment(a: { academicYearId: number; sectionId: number; classSubjectId: number; staffId: number }, tx?: Tx): Promise<Row>;
  deleteTeacherAssignment(id: number, tx?: Tx): Promise<boolean>;
  isTeacherAssigned(staffId: number, sectionId: number, classSubjectId?: number): Promise<boolean>;
  isClassTeacher(staffId: number, sectionId: number): Promise<boolean>;

  listCalendar(yearId: number): Promise<Row[]>;
  createCalendarEntry(e: { academicYearId: number; title: string; startDate: string; endDate: string; dayType: string; isHoliday: boolean }, tx?: Tx): Promise<Row>;
  isHoliday(date: string): Promise<boolean>;
}
