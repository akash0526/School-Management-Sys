import { z } from 'zod';

/** Common validation building blocks used by every module's api/*.schemas.ts */
export const id = z.coerce.number().int().positive();
export const idParam = z.object({ id });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD (AD)');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected time as HH:MM');
export const phone = z.string().trim().regex(/^\+?[0-9-]{7,20}$/, 'Invalid phone number');
export const money = z.coerce.number().nonnegative().multipleOf(0.01).max(99_999_999);
export const positiveMoney = z.coerce.number().positive().multipleOf(0.01).max(99_999_999);

/** http(s) URLs only — rejects javascript:, data:, file: … which would become stored XSS in the frontend. */
export const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) URLs are allowed');

/** Free-form custom fields (JSONB): bounded so nobody can store megabytes per record. */
export const customFields = z
  .record(z.string().trim().min(1).max(50), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .refine((o) => Object.keys(o).length <= 30, 'At most 30 custom fields');

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const toOffset = (p: PageQuery) => ({ limit: p.pageSize, offset: (p.page - 1) * p.pageSize });
