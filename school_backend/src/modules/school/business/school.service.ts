import type { AuthUser } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import { badRequest, notFound } from '../../../shared/errors.js';
import type { DemoAccount, ProfileInput, SchoolProfile, SchoolRepository } from './school.ports.js';

export const LOGO_PATH = '/api/v1/school/logo';
export const MAX_LOGO_BYTES = 300 * 1024;

/** Accepted logo formats, identified by their magic bytes (the declared type is not trusted). SVG is refused: it can carry script. */
const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

export interface Branding {
  name: string;
  nameNp: string | null;
  logoUrl: string | null;
  configured: boolean;
  /** Only in a demo database — lets visitors try each role from the login screen. */
  demoAccounts?: DemoAccount[];
}

/** BUSINESS LAYER — school identity used by the portal, receipts and report cards. */
export class SchoolService {
  constructor(
    private readonly repo: SchoolRepository,
    private readonly tx: TransactionRunner,
  ) {}

  /** Public, unauthenticated: just enough to brand the login screen. */
  async branding(): Promise<Branding> {
    const [p, demo] = await Promise.all([this.repo.getProfile(), this.repo.getDemoAccounts()]);
    const base: Branding = p
      ? { name: p.name, nameNp: p.nameNp, logoUrl: publicLogoUrl(p), configured: true }
      : { name: 'School Portal', nameNp: null, logoUrl: null, configured: false };
    return demo?.length ? { ...base, demoAccounts: demo } : base;
  }

  async profile() {
    const p = await this.repo.getProfile();
    return { profile: p ? { ...p, logoUrl: publicLogoUrl(p) } : null };
  }

  async saveProfile(actor: AuthUser, input: ProfileInput) {
    const p = await this.tx.transaction(actor.userId, (t) => this.repo.saveProfile(input, t));
    return { profile: { ...p, logoUrl: publicLogoUrl(p) } };
  }

  /** `dataUrl` = data:image/(png|jpeg|webp);base64,... */
  async setLogo(actor: AuthUser, dataUrl: string) {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw badRequest('Logo must be a base64 data URL');
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw badRequest(`Logo must be smaller than ${MAX_LOGO_BYTES / 1024} KB`);
    const kind = SIGNATURES.find((s) => s.test(bytes));
    if (!kind) throw badRequest('Logo must be a PNG, JPEG or WebP image');
    // store the normalised value with the detected type, never the client-declared one
    const p = await this.tx.transaction(actor.userId, (t) => this.repo.setLogo(`data:${kind.mime};base64,${bytes.toString('base64')}`, t));
    if (!p) throw badRequest('Save the school profile before uploading a logo');
    return { profile: { ...p, logoUrl: publicLogoUrl(p) } };
  }

  async removeLogo(actor: AuthUser) {
    const p = await this.tx.transaction(actor.userId, (t) => this.repo.setLogo(null, t));
    if (!p) throw notFound('School profile');
  }

  /** The uploaded logo as bytes, or null (no logo, or the logo is an external URL). */
  async logoImage(): Promise<{ mime: string; bytes: Buffer } | null> {
    const p = await this.repo.getProfile();
    const m = p?.logoUrl ? /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(p.logoUrl) : null;
    return m ? { mime: m[1], bytes: Buffer.from(m[2], 'base64') } : null;
  }
}

/** Uploaded logos are served from our own endpoint (cache-busted by updated_at); external URLs pass through. */
function publicLogoUrl(p: SchoolProfile): string | null {
  if (!p.logoUrl) return null;
  if (p.logoUrl.startsWith('data:')) return `${LOGO_PATH}?v=${p.updatedAt ? new Date(p.updatedAt).getTime() : 0}`;
  return p.logoUrl;
}
