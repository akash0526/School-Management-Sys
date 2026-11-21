import { z } from 'zod';
import { id, isoDate, time } from '../../../shared/http/params.js';

const status = z.enum(['present', 'absent', 'late', 'leave', 'half_day']);

export const sectionParam = z.object({ sectionId: id });
export const studentParam = z.object({ studentId: id });

export const markSectionBody = z
  .object({
    date: isoDate,
    periodId: id.nullish(),
    allowHoliday: z.boolean().optional(),
    records: z
      .array(z.object({ enrollmentId: id, status, remarks: z.string().trim().max(255).nullish() }).strict())
      .min(1)
      .max(200),
  })
  .strict();

export const rosterQuery = z.object({ date: isoDate, periodId: id.optional() });
export const rangeQuery = z.object({ from: isoDate, to: isoDate });
export const summaryQuery = z.object({ academicYearId: id.optional() });

export const markStaffBody = z
  .object({
    date: isoDate,
    records: z
      .array(
        z
          .object({ staffId: id, status, checkIn: time.nullish(), checkOut: time.nullish(), remarks: z.string().trim().max(255).nullish() })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const staffDateQuery = z.object({ date: isoDate });
