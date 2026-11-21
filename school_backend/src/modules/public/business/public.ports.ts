import type { Tx } from '../../../shared/db/database.js';

/** Scopes an API client can hold (stored in api_clients.scopes). */
export const PUBLIC_SCOPES = ['school.read', 'notices.read', 'events.read', 'staff.read', 'inquiries.create', 'results.lookup'] as const;
export type PublicScope = (typeof PUBLIC_SCOPES)[number];

export interface ApiClientRecord {
  id: number;
  name: string;
  scopes: string[];
  allowedIps: string[] | null;
  isActive: boolean;
}

export interface InquiryInput {
  externalRef?: string | null;
  studentName: string;
  dob?: string | null;
  gender?: string | null;
  applyingClassId?: number | null;
  applyingClassName?: string | null;
  streamId?: number | null;
  guardianName?: string | null;
  phone: string;
  email?: string | null;
  message?: string | null;
}

export interface PublicRepository {
  findClientByKeyHash(hash: string): Promise<ApiClientRecord | null>;
  touchClient(id: number): Promise<void>;
  setClientActive(name: string, active: boolean, tx: Tx): Promise<boolean>;
  rotateClientKey(name: string, keyHash: string, tx: Tx): Promise<boolean>;
  createClient(c: { name: string; keyHash: string; scopes: string[]; allowedIps: string[] | null }, tx: Tx): Promise<number>;

  schoolProfile(): Promise<Record<string, unknown> | null>;
  notices(f: { updatedSince?: string; limit: number; offset: number }): Promise<{ items: Record<string, unknown>[]; total: number }>;
  notice(id: number): Promise<Record<string, unknown> | null>;
  events(f: { from?: string; to?: string; limit: number; offset: number }): Promise<{ items: Record<string, unknown>[]; total: number }>;
  staff(): Promise<Record<string, unknown>[]>;
  classes(): Promise<Array<{ id: number; name: string }>>;

  classIdByName(name: string): Promise<number | null>;
  findInquiryByExternalRef(ref: string): Promise<number | null>;
  createInquiry(i: InquiryInput & { applyingClassId: number | null }, tx: Tx): Promise<number>;

  lookupResults(f: { symbolNo?: string; admissionNo?: string; dob: string; examId?: number }): Promise<Record<string, unknown>[]>;
}
