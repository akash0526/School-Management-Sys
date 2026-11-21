import { z } from 'zod';
import { id, isoDate, money, pageQuery, positiveMoney } from '../../../shared/http/params.js';

const frequency = z.enum(['one_time', 'monthly', 'termly', 'yearly']);
const method = z.enum(['cash', 'bank_deposit', 'cheque', 'esewa', 'khalti', 'fonepay', 'connectips', 'other']);

export const feeTypeBody = z
  .object({ code: z.string().trim().min(2).max(20).regex(/^[A-Za-z_]+$/), name: z.string().trim().min(1).max(100), isRefundable: z.boolean().optional() })
  .strict();

export const structuresQuery = z.object({ academicYearId: id, classId: id.optional() });
export const structureBody = z
  .object({ academicYearId: id, classId: id, streamId: id.nullish(), feeTypeId: id, amount: money, frequency, dueDay: z.number().int().min(1).max(32).nullish() })
  .strict();

export const discountBody = z
  .object({
    enrollmentId: id,
    feeTypeId: id.nullish(),
    discountType: z.enum(['percent', 'fixed']),
    value: money,
    reason: z.enum(['scholarship', 'sibling', 'staff_child', 'merit', 'need_based', 'other']),
    validFrom: isoDate.nullish(),
    validTo: isoDate.nullish(),
  })
  .strict()
  .refine((d) => d.discountType !== 'percent' || d.value <= 100, { message: 'Percent discount cannot exceed 100', path: ['value'] });
export const discountsQuery = z.object({ enrollmentId: id });

export const generateBody = z
  .object({
    academicYearId: id,
    classId: id.optional(),
    sectionId: id.optional(),
    billingPeriod: z.string().trim().min(1).max(30), // e.g. "2083-Baisakh", "First Term"
    frequencies: z.array(frequency).min(1),
    feeTypeIds: z.array(id).max(30).optional(),
    issueDate: isoDate,
    dueDate: isoDate.nullish(),
  })
  .strict();

export const invoicesQuery = pageQuery.extend({
  studentId: id.optional(),
  sectionId: id.optional(),
  status: z.enum(['draft', 'unpaid', 'partial', 'paid', 'cancelled']).optional(),
  billingPeriod: z.string().trim().max(30).optional(),
});

export const cancelBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export const receiptBody = z
  .object({
    studentId: id,
    amount: positiveMoney,
    method,
    referenceNo: z.string().trim().max(100).nullish(),
    paymentDate: isoDate.optional(),
    allocations: z
      .array(z.object({ invoiceId: id, amount: positiveMoney }).strict())
      .max(50)
      .refine((a) => new Set(a.map((x) => x.invoiceId)).size === a.length, 'Each invoice may appear only once in allocations')
      .optional(),
  })
  .strict();

export const studentParam = z.object({ studentId: id });
