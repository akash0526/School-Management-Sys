import { z } from 'zod';
import { customFields, httpUrl, id, isoDate, pageQuery, phone } from '../../../shared/http/params.js';

const text = (max: number) => z.string().trim().max(max).nullish();

export const staffBody = z
  .object({
    employeeNo: z.string().trim().min(1).max(30),
    firstName: z.string().trim().min(1).max(50),
    middleName: text(50),
    lastName: z.string().trim().min(1).max(50),
    fullNameNp: text(150),
    gender: z.enum(['male', 'female', 'other']),
    dob: isoDate.nullish(),
    phone,
    email: z.string().trim().email().max(150).nullish(),
    address: text(500),
    departmentId: id.nullish(),
    designation: z.string().trim().min(1).max(80),
    staffType: z.enum(['teaching', 'non_teaching']),
    employmentType: z.enum(['permanent', 'temporary', 'contract', 'part_time']).optional(),
    qualification: text(150),
    teachingLicenseNo: text(50),
    citizenshipNo: text(50),
    panNo: text(20),
    bankName: text(100),
    bankAccountNo: text(50),
    photoUrl: httpUrl.nullish(),
    joinDate: isoDate,
    leaveDate: isoDate.nullish(),
    status: z.enum(['active', 'on_leave', 'resigned', 'retired', 'terminated']).optional(),
    showOnWebsite: z.boolean().optional(),
    publicBio: text(2000),
    websiteOrder: z.number().int().min(0).max(10000).nullish(),
    customFields: customFields.optional(),
  })
  .strict();

export const updateStaffBody = staffBody.partial().strict();

export const listStaffQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  departmentId: id.optional(),
  staffType: z.enum(['teaching', 'non_teaching']).optional(),
  status: z.enum(['active', 'on_leave', 'resigned', 'retired', 'terminated']).optional(),
});

export const staffAccountBody = z
  .object({
    username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/),
    password: z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/[0-9]/).optional(),
    roles: z.array(z.string().max(50)).min(1).max(5),
  })
  .strict();

export const departmentBody = z.object({ name: z.string().trim().min(1).max(100) }).strict();
