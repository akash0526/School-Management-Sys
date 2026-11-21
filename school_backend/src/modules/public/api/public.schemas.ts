import { z } from 'zod';
import { id, isoDate, pageQuery, phone } from '../../../shared/http/params.js';

const text = (max: number) => z.string().trim().min(1).max(max);

export const noticesQuery = pageQuery.extend({ updatedSince: z.string().datetime({ offset: true }).optional() });
export const eventsQuery = pageQuery.extend({ from: isoDate.optional(), to: isoDate.optional() });

export const inquiryBody = z
  .object({
    externalRef: text(50).optional(), // website's own inquiry id → idempotent sync
    studentName: text(150),
    dob: isoDate.optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    applyingClassId: id.optional(),
    applyingClassName: text(50).optional(),
    streamId: id.optional(),
    guardianName: text(150).optional(),
    phone,
    email: z.string().trim().email().max(150).optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .strict();

export const resultLookupBody = z
  .object({
    symbolNo: text(30).optional(),
    admissionNo: text(30).optional(),
    dob: isoDate,
    examId: id.optional(),
  })
  .strict()
  .refine((b) => !!b.symbolNo !== !!b.admissionNo, { message: 'Provide exactly one of symbolNo or admissionNo' });
