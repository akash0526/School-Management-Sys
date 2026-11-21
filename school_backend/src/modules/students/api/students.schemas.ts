import { z } from 'zod';
import { customFields, httpUrl, id, isoDate, pageQuery, phone } from '../../../shared/http/params.js';

const nullableText = (max: number) => z.string().trim().max(max).nullish();

export const studentBody = z
  .object({
    admissionNo: z.string().trim().min(1).max(30),
    firstName: z.string().trim().min(1).max(50),
    middleName: nullableText(50),
    lastName: z.string().trim().min(1).max(50),
    fullNameNp: nullableText(150),
    gender: z.enum(['male', 'female', 'other']),
    dob: isoDate,
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullish(),
    religion: nullableText(50),
    casteEthnicity: nullableText(80),
    motherTongue: nullableText(50),
    nationality: z.string().trim().max(50).optional(),
    disabilityType: nullableText(80),
    birthCertNo: nullableText(50),
    province: nullableText(50),
    district: nullableText(50),
    localLevel: nullableText(80),
    wardNo: z.number().int().min(1).max(40).nullish(),
    tole: nullableText(100),
    temporaryAddress: nullableText(500),
    phone: phone.nullish(),
    email: z.string().trim().email().max(150).nullish(),
    photoUrl: httpUrl.nullish(),
    previousSchool: nullableText(150),
    admissionDate: isoDate.optional(),
    customFields: customFields.optional(),
  })
  .strict();

export const updateStudentBody = studentBody.partial().strict();

export const listStudentsQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  status: z.enum(['active', 'inactive', 'transferred', 'left', 'graduated', 'dropped']).optional(),
});

export const statusBody = z
  .object({
    status: z.enum(['active', 'inactive', 'transferred', 'left', 'graduated', 'dropped']),
    date: isoDate,
    reason: z.string().trim().max(500).nullish(),
  })
  .strict();

export const guardianBody = z
  .object({
    fullName: z.string().trim().min(1).max(150),
    phone,
    altPhone: phone.nullish(),
    email: z.string().trim().email().max(150).nullish(),
    occupation: nullableText(100),
    organization: nullableText(150),
    citizenshipNo: nullableText(50),
    address: nullableText(500),
  })
  .strict();
export const updateGuardianBody = guardianBody.partial().strict();

export const addGuardianBody = z
  .object({
    guardianId: id.optional(),
    guardian: guardianBody.optional(),
    relation: z.enum(['father', 'mother', 'grandfather', 'grandmother', 'brother', 'sister', 'uncle', 'aunt', 'other']),
    isPrimary: z.boolean().default(false),
    canPickup: z.boolean().default(true),
  })
  .strict();

export const accountBody = z
  .object({
    username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/),
    password: z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/[0-9]/).optional(),
  })
  .strict();

export const listGuardiansQuery = pageQuery.extend({ search: z.string().trim().max(60).optional() });
export const studentGuardianParams = z.object({ id, guardianId: id });
