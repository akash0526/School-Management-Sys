import type { Tx } from '../../../shared/db/database.js';

export interface SchoolProfile {
  name: string;
  nameNp: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  panNo: string | null;
  schoolCode: string | null;
  establishedYear: number | null;
  /** http(s) URL, or a `data:image/...;base64,` value for an uploaded logo. */
  logoUrl: string | null;
  updatedAt: string | null;
}

export interface DemoAccount {
  role: string;
  username: string;
  password: string;
}

export type ProfileInput = Omit<SchoolProfile, 'logoUrl' | 'updatedAt'>;

export interface SchoolRepository {
  getProfile(): Promise<SchoolProfile | null>;
  /** Present only in a demo database (written by scripts/seed-demo.ts). */
  getDemoAccounts(): Promise<DemoAccount[] | null>;
  /** Insert-or-update the single profile row (id = 1). */
  saveProfile(p: ProfileInput, tx: Tx): Promise<SchoolProfile>;
  /** Fails (returns null) when no profile has been saved yet. */
  setLogo(logoUrl: string | null, tx: Tx): Promise<SchoolProfile | null>;
}
