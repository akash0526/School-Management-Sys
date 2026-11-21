import { describe, expect, it } from 'vitest';
import type { DemoAccount, ProfileInput, SchoolProfile, SchoolRepository } from '../../src/modules/school/business/school.ports.js';
import { SchoolService } from '../../src/modules/school/business/school.service.js';
import { profileBody } from '../../src/modules/school/api/school.schemas.js';
import type { AuthUser } from '../../src/shared/auth/types.js';

const actor = { userId: 1, roles: ['super_admin'], permissions: ['settings.manage'] } as unknown as AuthUser;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

function fake(initial: SchoolProfile | null = null, demo: DemoAccount[] | null = null) {
  let profile = initial;
  const repo: SchoolRepository = {
    getProfile: async () => profile,
    getDemoAccounts: async () => demo,
    saveProfile: async (p: ProfileInput) => (profile = { ...p, logoUrl: profile?.logoUrl ?? null, updatedAt: '2026-11-19T10:00:00.000Z' }),
    setLogo: async (logoUrl) => (profile ? (profile = { ...profile, logoUrl, updatedAt: '2026-11-19T11:00:00.000Z' }) : null),
  };
  const tx = { transaction: (_: number | null, fn: (t: any) => Promise<any>) => fn({}) };
  return { service: new SchoolService(repo, tx), get: () => profile };
}
const base: ProfileInput = { name: 'Himalayan Model', nameNp: null, address: null, phone: null, email: null, website: null, panNo: null, schoolCode: null, establishedYear: null };

describe('school branding', () => {
  it('falls back to a generic name before the profile is set up', async () => {
    expect(await fake().service.branding()).toEqual({ name: 'School Portal', nameNp: null, logoUrl: null, configured: false });
  });
  it('serves an uploaded logo from our own endpoint with a cache-busting version', async () => {
    const { service } = fake({ ...base, logoUrl: `data:image/png;base64,${PNG.toString('base64')}`, updatedAt: '2026-11-19T11:00:00.000Z' });
    const b = await service.branding();
    expect(b.logoUrl).toBe(`/api/v1/school/logo?v=${Date.parse('2026-11-19T11:00:00.000Z')}`);
    expect(b.configured).toBe(true);
  });
  it('only exposes demo accounts when the demo data is loaded', async () => {
    const demo = [{ role: 'Teacher', username: 'teacher', password: 'x' }];
    expect((await fake(null, demo).service.branding()).demoAccounts).toEqual(demo);
    expect(await fake(null, []).service.branding()).not.toHaveProperty('demoAccounts');
  });
});

describe('school logo upload', () => {
  it('accepts PNG and JPEG, stored with the DETECTED type (not the declared one)', async () => {
    const f = fake({ ...base, logoUrl: null, updatedAt: null });
    await f.service.setLogo(actor, `data:image/webp;base64,${JPEG.toString('base64')}`);
    expect(f.get()?.logoUrl).toMatch(/^data:image\/jpeg;base64,/);
    await f.service.setLogo(actor, `data:image/png;base64,${PNG.toString('base64')}`);
    expect(await f.service.logoImage()).toEqual({ mime: 'image/png', bytes: PNG });
  });
  it('rejects SVG (can carry script), HTML disguised as PNG, and oversize files', async () => {
    const { service } = fake({ ...base, logoUrl: null, updatedAt: null });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    await expect(service.setLogo(actor, `data:image/svg+xml;base64,${svg}`)).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(service.setLogo(actor, `data:image/png;base64,${Buffer.from('<html>').toString('base64')}`)).rejects.toThrow(/PNG, JPEG or WebP/);
    const big = Buffer.concat([PNG, Buffer.alloc(301 * 1024)]).toString('base64');
    await expect(service.setLogo(actor, `data:image/png;base64,${big}`)).rejects.toThrow(/smaller than/);
    await expect(service.setLogo(actor, 'https://example.com/logo.png')).rejects.toThrow(/data URL/);
  });
  it('requires the profile to exist first', async () => {
    await expect(fake().service.setLogo(actor, `data:image/png;base64,${PNG.toString('base64')}`)).rejects.toThrow(/Save the school profile/);
  });
});

describe('school profile validation', () => {
  it('normalises empty optional fields to null and lower-cases email', () => {
    const p = profileBody.parse({ name: '  Himalayan Model ', email: 'Info@School.EDU.np', phone: '', website: '', panNo: '' });
    expect(p).toMatchObject({ name: 'Himalayan Model', email: 'info@school.edu.np', phone: null, website: null, panNo: null, address: null });
  });
  it('rejects bad PAN, non-http website and unknown fields', () => {
    expect(profileBody.safeParse({ name: 'School', panNo: '1234' }).success).toBe(false);
    expect(profileBody.safeParse({ name: 'School', website: 'javascript:alert(1)' }).success).toBe(false);
    expect(profileBody.safeParse({ name: 'School', logoUrl: 'x' }).success).toBe(false);
  });
});
