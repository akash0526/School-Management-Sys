import { z } from 'zod';
import { id, isoDate } from '../../../shared/http/params.js';

export const yearBody = z.object({ name: z.string().trim().min(1).max(20), startDate: isoDate, endDate: isoDate }).strict();
export const termBody = z
  .object({ name: z.string().trim().min(1).max(50), sequence: z.number().int().min(1).max(10), startDate: isoDate, endDate: isoDate })
  .strict();

export const sectionsQuery = z.object({ academicYearId: id.optional(), classId: id.optional() });
export const sectionBody = z
  .object({
    academicYearId: id,
    classId: id,
    streamId: id.nullish(),
    name: z.string().trim().min(1).max(20),
    classTeacherId: id.nullish(),
    roomId: id.nullish(),
    capacity: z.number().int().min(1).max(500).nullish(),
  })
  .strict();
export const updateSectionBody = z
  .object({
    name: z.string().trim().min(1).max(20).optional(),
    classTeacherId: id.nullable().optional(),
    roomId: id.nullable().optional(),
    capacity: z.number().int().min(1).max(500).nullable().optional(),
    streamId: id.nullable().optional(),
  })
  .strict();

export const subjectBody = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(100),
    nameNp: z.string().trim().max(100).nullish(),
    hasPractical: z.boolean().optional(),
  })
  .strict();

export const classSubjectsQuery = z.object({ academicYearId: id.optional(), classId: id.optional(), streamId: id.optional() });
export const classSubjectBody = z
  .object({
    academicYearId: id,
    classId: id,
    streamId: id.nullish(),
    subjectId: id,
    creditHours: z.number().positive().max(20).nullish(),
    isOptional: z.boolean().optional(),
    optionalGroup: z.string().trim().max(30).nullish(),
    sequence: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const assignmentsQuery = z.object({ academicYearId: id.optional(), staffId: id.optional(), sectionId: id.optional() });
export const assignmentBody = z.object({ sectionId: id, classSubjectId: id, staffId: id }).strict();

export const calendarQuery = z.object({ academicYearId: id.optional() });
export const calendarBody = z
  .object({
    academicYearId: id,
    title: z.string().trim().min(1).max(150),
    startDate: isoDate,
    endDate: isoDate,
    dayType: z.enum(['holiday', 'vacation', 'exam', 'event', 'half_day']),
    isHoliday: z.boolean().default(true),
  })
  .strict();
