import type { AuthUser } from '../../../shared/auth/types.js';
import type { Tx } from '../../../shared/db/database.js';

// ----------------------------- DTOs -----------------------------
export interface StudentInput {
  admissionNo: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  fullNameNp?: string | null;
  gender: 'male' | 'female' | 'other';
  dob: string;
  bloodGroup?: string | null;
  religion?: string | null;
  casteEthnicity?: string | null;
  motherTongue?: string | null;
  nationality?: string;
  disabilityType?: string | null;
  birthCertNo?: string | null;
  province?: string | null;
  district?: string | null;
  localLevel?: string | null;
  wardNo?: number | null;
  tole?: string | null;
  temporaryAddress?: string | null;
  phone?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  previousSchool?: string | null;
  admissionDate?: string;
  customFields?: Record<string, unknown>;
}

export interface GuardianInput {
  fullName: string;
  phone: string;
  altPhone?: string | null;
  email?: string | null;
  occupation?: string | null;
  organization?: string | null;
  citizenshipNo?: string | null;
  address?: string | null;
}

export type Student = Record<string, unknown> & { id: number; userId: number | null; status: string };
export type Guardian = Record<string, unknown> & { id: number; userId: number | null };

export type StudentStatus = 'active' | 'inactive' | 'transferred' | 'left' | 'graduated' | 'dropped';

// ----------------------- Repository port ------------------------
export interface StudentsRepository {
  list(f: { search?: string; status?: string; limit: number; offset: number }): Promise<{ items: Student[]; total: number }>;
  findById(id: number, tx?: Tx): Promise<Student | null>;
  findIdByUserId(userId: number): Promise<number | null>;
  getStatus(id: number): Promise<string | null>;
  create(input: StudentInput, tx?: Tx): Promise<Student>;
  update(id: number, input: Partial<StudentInput>, tx?: Tx): Promise<Student | null>;
  setStatus(id: number, status: StudentStatus, leftDate: string | null, tx: Tx): Promise<void>;
  addStatusHistory(h: { studentId: number; oldStatus: string; newStatus: string; changedOn: string; reason?: string | null; changedBy: number }, tx: Tx): Promise<void>;
  setUserId(studentId: number, userId: number, tx: Tx): Promise<void>;

  isGuardianOf(guardianId: number, studentId: number): Promise<boolean>;
  listGuardiansOfStudent(studentId: number): Promise<Record<string, unknown>[]>;
  linkGuardian(l: { studentId: number; guardianId: number; relation: string; isPrimary: boolean; canPickup: boolean }, tx: Tx): Promise<void>;
  unlinkGuardian(studentId: number, guardianId: number, tx?: Tx): Promise<boolean>;
  listChildrenOfGuardian(guardianId: number): Promise<Record<string, unknown>[]>;

  listGuardians(f: { search?: string; limit: number; offset: number }): Promise<{ items: Guardian[]; total: number }>;
  findGuardianById(id: number, tx?: Tx): Promise<Guardian | null>;
  findGuardianIdByUserId(userId: number): Promise<number | null>;
  createGuardian(input: GuardianInput, tx?: Tx): Promise<Guardian>;
  updateGuardian(id: number, input: Partial<GuardianInput>, tx?: Tx): Promise<Guardian | null>;
  setGuardianUserId(guardianId: number, userId: number, tx: Tx): Promise<void>;
}

// ---------------- Ports to OTHER modules (wired by container) ----------------
/** Provided by the auth module. Defined here so students never imports auth. */
export interface UserAccountService {
  createAccount(
    actor: AuthUser,
    input: { username: string; email?: string | null; phone?: string | null; password?: string; roles: string[] },
    tx?: Tx,
  ): Promise<{ userId: number; username: string; temporaryPassword?: string }>;
  /** The person has left: deactivate their login and end its sessions (inside the caller's transaction). */
  deactivateLinkedAccount(actor: AuthUser, userId: number, reason: string, tx: Tx): Promise<void>;
}
