import { z } from 'zod';
import { id, isoDate, time } from '../../../shared/http/params.js';

const marks = z.number().min(0).max(1000).multipleOf(0.01);

export const examBody = z
  .object({
    academicYearId: id,
    termId: id.nullish(),
    name: z.string().trim().min(1).max(100),
    examType: z.enum(['unit', 'terminal', 'final', 'pre_board', 'entrance']),
    gradingScaleId: id.nullish(),
    weightageInFinal: z.number().min(0).max(100).nullish(),
    startDate: isoDate.nullish(),
    endDate: isoDate.nullish(),
  })
  .strict();

export const updateExamBody = examBody.omit({ academicYearId: true, termId: true, weightageInFinal: true }).partial().strict();
export const listExamsQuery = z.object({ academicYearId: id.optional() });

export const scheduleBody = z
  .object({
    classSubjectId: id,
    examDate: isoDate.nullish(),
    startTime: time.nullish(),
    endTime: time.nullish(),
    roomId: id.nullish(),
    components: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(30),
            componentType: z.enum(['theory', 'practical', 'internal', 'project', 'oral', 'cas']),
            fullMarks: marks.positive(),
            passMarks: marks,
            creditHours: z.number().positive().max(20).nullish(),
            sequence: z.number().int().min(0).max(50).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();

export const schedulesQuery = z.object({ classId: id.optional() });

export const componentParam = z.object({ componentId: id });
export const sectionQuery = z.object({ sectionId: id });

export const marksBody = z
  .object({
    sectionId: id,
    entries: z
      .array(
        z
          .object({
            enrollmentId: id,
            marksObtained: marks.nullable(),
            isAbsent: z.boolean().default(false),
            remarks: z.string().trim().max(255).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const verifyBody = z.object({ sectionId: id, classSubjectId: id.nullish() }).strict();
export const processBody = z.object({ sectionId: id.nullish(), force: z.boolean().default(false) }).strict();
export const publishBody = z.object({ published: z.boolean() }).strict();

/**
 * Withhold / release. Target either explicit enrollments or a whole section — one of the
 * two is required, so a bare {withheld:true} can never withhold the entire school by accident.
 */
export const withholdBody = z
  .object({
    withheld: z.boolean(),
    enrollmentIds: z.array(id).min(1).max(2000).optional(),
    sectionId: id.optional(),
  })
  .strict()
  .refine((b) => b.enrollmentIds || b.sectionId, {
    message: 'Provide enrollmentIds (specific students) or sectionId (a whole section)',
  });
export const resultsQuery = z.object({ sectionId: id.optional() });
export const reportCardParams = z.object({ id, studentId: id });
export const studentResultsParams = z.object({ studentId: id });
