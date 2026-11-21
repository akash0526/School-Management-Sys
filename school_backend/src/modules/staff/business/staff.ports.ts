import type { AuthUser } from '../../../shared/auth/types.js';
import type { Tx } from '../../../shared/db/database.js';

export interface StaffInput {
  employeeNo: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  fullNameNp?: string | null;
  gender: 'male' | 'female' | 'other';
  dob?: string | null;
  phone: string;
  email?: string | null;
  address?: string | null;
  departmentId?: number | null;
  designation: string;
  staffType: 'teaching' | 'non_teaching';
  employmentType?: 'permanent' | 'temporary' | 'contract' | 'part_time';
  qualification?: string | null;
  teachingLicenseNo?: string | null;
  citizenshipNo?: string | null;
  panNo?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  photoUrl?: string | null;
  joinDate: string;
  leaveDate?: string | null;
  status?: 'active' | 'on_leave' | 'resigned' | 'retired' | 'terminated';
  showOnWebsite?: boolean;
  publicBio?: string | null;
  websiteOrder?: number | null;
  customFields?: Record<string, unknown>;
}

export type StaffMember = Record<string, unknown> & { id: number; userId: number | null };

export interface StaffRepository {
  list(f: { search?: string; departmentId?: number; staffType?: string; status?: string; limit: number; offset: number }): Promise<{ items: StaffMember[]; total: number }>;
  findById(id: number, tx?: Tx): Promise<StaffMember | null>;
  findIdByUserId(userId: number): Promise<number | null>;
  create(input: StaffInput, tx?: Tx): Promise<StaffMember>;
  update(id: number, input: Partial<StaffInput>, tx?: Tx): Promise<StaffMember | null>;
  setUserId(staffId: number, userId: number, tx: Tx): Promise<void>;
  listDepartments(): Promise<unknown[]>;
  createDepartment(name: string, tx?: Tx): Promise<unknown>;
}

/** Provided by the auth module (wired in container). */
export interface UserAccountService {
  createAccount(
    actor: AuthUser,
    input: { username: string; email?: string | null; phone?: string | null; password?: string; roles: string[] },
    tx?: Tx,
  ): Promise<{ userId: number; username: string; temporaryPassword?: string }>;
  /** The person has left: deactivate their login and end its sessions (inside the caller's transaction). */
  deactivateLinkedAccount(actor: AuthUser, userId: number, reason: string, tx: Tx): Promise<void>;
}
