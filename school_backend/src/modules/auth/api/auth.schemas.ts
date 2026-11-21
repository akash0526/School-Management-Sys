import { z } from 'zod';
import { pageQuery, phone } from '../../../shared/http/params.js';

/** Shape check only — the full policy (common passwords, username, 72-byte limit) is enforced in business/passwordPolicy.ts. */
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const username = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Username may contain letters, numbers, dot, dash and underscore');

export const loginBody = z.object({ username: z.string().trim().min(1).max(50), password: z.string().min(1).max(128) }).strict();
export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200).optional() }).strict();
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict();

export const listUsersQuery = pageQuery.extend({ search: z.string().trim().max(50).optional() });
export const createUserBody = z
  .object({
    username,
    email: z.string().trim().email().max(150).nullish(),
    phone: phone.nullish(),
    password: password.optional(),
    roles: z.array(z.string().max(50)).min(1).max(10),
  })
  .strict();
export const updateUserBody = z
  .object({ email: z.string().trim().email().max(150).nullable().optional(), phone: phone.nullable().optional(), isActive: z.boolean().optional() })
  .strict();
export const setRolesBody = z.object({ roles: z.array(z.string().max(50)).max(10) }).strict();

export const securityEventsQuery = pageQuery.extend({
  type: z.string().trim().max(40).regex(/^[a-z_]+$/).optional(),
  userId: z.coerce.number().int().positive().optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  since: z.string().datetime({ offset: true }).optional(),
});
