import { z } from 'zod';
import { httpUrl, phone } from '../../../shared/http/params.js';

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const profileBody = z
  .object({
    name: z.string().trim().min(2).max(150),
    nameNp: opt(150),
    address: opt(300),
    phone: phone.nullish().or(z.literal('')).transform((v) => (v ? v : null)),
    email: z.email().max(150).nullish().or(z.literal('')).transform((v) => (v ? v.toLowerCase() : null)),
    website: httpUrl.nullish().or(z.literal('')).transform((v) => (v ? v : null)),
    panNo: z.string().trim().regex(/^\d{9}$/, 'PAN must be 9 digits').nullish().or(z.literal('')).transform((v) => (v ? v : null)),
    schoolCode: opt(30),
    establishedYear: z.number().int().min(1800).max(2200).nullish().transform((v) => v ?? null),
  })
  .strict();

// ~300 KB of image → ~400 KB of base64; the JSON body limit is 1 MB
export const logoBody = z.object({ dataUrl: z.string().max(450_000) }).strict();
