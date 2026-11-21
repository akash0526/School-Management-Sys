import { z } from 'zod';
import { id } from '../../../shared/http/params.js';

export const listQuery = z.object({
  sectionId: id.optional(),
  academicYearId: id.optional(),
  studentId: id.optional(),
  status: z.enum(['studying', 'promoted', 'repeated', 'transferred', 'left', 'graduated']).optional(),
});

export const enrollBody = z
  .object({
    studentId: id,
    sectionId: id,
    rollNo: z.number().int().min(1).max(999).nullish(),
    symbolNo: z.string().trim().max(30).nullish(),
    registrationNo: z.string().trim().max(30).nullish(),
  })
  .strict();

export const updateBody = z
  .object({
    rollNo: z.number().int().min(1).max(999).nullable().optional(),
    symbolNo: z.string().trim().max(30).nullable().optional(),
    registrationNo: z.string().trim().max(30).nullable().optional(),
    status: z.enum(['studying', 'promoted', 'repeated', 'transferred', 'left', 'graduated']).optional(),
    remarks: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const subjectsBody = z.object({ classSubjectIds: z.array(id).max(10) }).strict();

export const promoteBody = z
  .object({
    enrollmentIds: z.array(id).min(1).max(500),
    targetSectionId: id,
    outcome: z.enum(['promoted', 'repeated']),
  })
  .strict();

export const sectionParam = z.object({ sectionId: id });
