import type { BrandingDto, OrganizationDto } from '@gatefit/shared';
import request from 'supertest';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  createStaff,
  createTestApp,
  hostOf,
  type StaffFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization } from './support/db';

const HOURS = { open: '06:00', close: '23:00' };

/** A PNG header of the given size: enough for the API, which never decodes the image. */
function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const binary = (req: request.Test) =>
  req.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    res.on('end', () => {
      done(null, Buffer.concat(chunks));
    });
  });
const WORKING_HOURS = {
  mon: HOURS,
  tue: HOURS,
  wed: HOURS,
  thu: HOURS,
  fri: HOURS,
  sat: { open: '08:00', close: '20:00' },
  sun: null,
};

describe('Organization settings and locations (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let ownerUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  let manager: ReturnType<typeof apiAs>;
  let outsider: ReturnType<typeof apiAs>;

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');

    ownerUser = await createStaff(admin, orgA, 'owner');
    owner = apiAs(t, orgA, await cookiesFor(t, orgA, ownerUser));
    manager = apiAs(t, orgA, await cookiesFor(t, orgA, await createStaff(admin, orgA, 'manager')));
    outsider = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('GET /organization', () => {
    it('returns the current organization', async () => {
      const response = await manager.get('/organization').expect(200);
      expect(response.body).toEqual({
        id: orgA.id,
        name: orgA.name,
        slug: orgA.slug,
        country: 'UZ',
        currency: 'UZS',
        locale: 'uz',
        theme: 'zumrad',
        logoUrl: null,
        status: 'trial',
        trialEndsAt: null,
        plan: null,
      });
    });

    it('requires a session', async () => {
      await apiAs(t, orgA, []).get('/organization').expect(401);
    });
  });

  describe('PATCH /organization', () => {
    it('lets the owner change the name and language, and records it', async () => {
      const response = await owner
        .patch('/organization', { name: '  Fit Club  ', locale: 'ru' })
        .expect(200);
      expect(response.body).toMatchObject({ id: orgA.id, name: 'Fit Club', locale: 'ru' });

      const [entry] = await admin.auditLog.findMany({
        where: { organizationId: orgA.id, action: 'organization.update' },
      });
      expect(entry).toMatchObject({
        actorId: ownerUser.userId,
        entity: 'organization',
        entityId: orgA.id,
        before: { name: orgA.name, locale: 'uz', theme: 'zumrad' },
        after: { name: 'Fit Club', locale: 'ru', theme: 'zumrad' },
      });
    });

    it('lets the owner pick a theme, and records it', async () => {
      const response = await owner.patch('/organization', { theme: 'olov' }).expect(200);
      expect(response.body).toMatchObject({ id: orgA.id, theme: 'olov' });

      const entries = await admin.auditLog.findMany({
        where: { organizationId: orgA.id, action: 'organization.update' },
        orderBy: { at: 'desc' },
      });
      expect(entries[0]).toMatchObject({
        before: { theme: 'zumrad' },
        after: { theme: 'olov' },
      });
    });

    it('rejects an unknown theme', async () => {
      await owner.patch('/organization', { theme: 'pink' }).expect(400);
    });

    it('does not touch another organization', async () => {
      const other = await outsider.get('/organization').expect(200);
      expect(other.body).toMatchObject({
        id: orgB.id,
        name: orgB.name,
        locale: 'uz',
        theme: 'zumrad',
      });
    });

    it('is refused to a manager', async () => {
      const response = await manager.patch('/organization', { name: 'Nope' }).expect(403);
      expect(response.body).toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects an unsupported language and an empty change', async () => {
      await owner.patch('/organization', { locale: 'de' }).expect(400);
      await owner.patch('/organization', {}).expect(400);
    });

    it('cannot change country or currency', async () => {
      // Unknown fields are dropped, which leaves nothing to update.
      await owner.patch('/organization', { country: 'US', currency: 'USD' }).expect(400);
      const unchanged = await admin.organization.findUniqueOrThrow({ where: { id: orgA.id } });
      expect(unchanged).toMatchObject({ country: 'UZ', currency: 'UZS' });
    });
  });

  describe('GET /branding', () => {
    it('tells anyone at the address the name and theme, and nothing else', async () => {
      const response = await apiAs(t, orgA, []).get('/branding').expect(200);
      expect(response.body).toEqual({ name: 'Fit Club', theme: 'olov', logoUrl: null });
    });

    it('answers for the organization of the address only', async () => {
      const response = await apiAs(t, orgB, []).get('/branding').expect(200);
      expect(response.body).toEqual({ name: orgB.name, theme: 'zumrad', logoUrl: null });
    });

    it('needs an organization address', async () => {
      await request(t.app.getHttpServer())
        .get('/api/v1/branding')
        .set('Host', 'localhost')
        .expect(404);
      await request(t.app.getHttpServer())
        .get('/api/v1/branding')
        .set('Host', 'nobody.localhost')
        .expect(404);
    });
  });

  describe('logo', () => {
    const LOGO = png(512, 256);
    const fetchFile = (org: Organization, url: string) =>
      binary(request(t.app.getHttpServer()).get(url).set('Host', hostOf(org)));

    it('lets the owner upload a logo, shows it in branding, and records it', async () => {
      const response = await owner
        .upload('put', '/organization/logo', LOGO, 'logo.png')
        .expect(200);
      const body = response.body as OrganizationDto;
      expect(body.logoUrl).toMatch(/^\/api\/v1\/files\/[\w-]+\.[0-9a-f]{64}$/);

      const branding = (await apiAs(t, orgA, []).get('/branding').expect(200)).body as BrandingDto;
      expect(branding.logoUrl).toEqual(expect.any(String));
      const file = await fetchFile(orgA, branding.logoUrl ?? '').expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      expect(file.body).toEqual(LOGO);

      const [entry] = await admin.auditLog.findMany({
        where: { organizationId: orgA.id, action: 'organization.logo.upload' },
      });
      expect(entry).toMatchObject({
        actorId: ownerUser.userId,
        entityId: orgA.id,
        before: { logoKey: null },
        after: { contentType: 'image/png', width: 512, height: 256 },
      });
    });

    it('replaces the old file and records the replacement', async () => {
      const first = (await owner.get('/organization').expect(200)).body as OrganizationDto;
      const second = (
        await owner.upload('put', '/organization/logo', png(300, 300), 'new.png').expect(200)
      ).body as OrganizationDto;
      expect(second.logoUrl).not.toBe(first.logoUrl);
      await fetchFile(orgA, first.logoUrl ?? '').expect(404);
      await fetchFile(orgA, second.logoUrl ?? '').expect(200);
      expect(
        await admin.auditLog.count({
          where: { organizationId: orgA.id, action: 'organization.logo.replace' },
        }),
      ).toBe(1);
    });

    it('refuses SVG, unknown files, a missing file and oversized images', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
      const refused = await owner.upload('put', '/organization/logo', svg, 'logo.png').expect(422);
      expect(refused.body).toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
      await owner
        .upload('put', '/organization/logo', Buffer.from('GIF89a'), 'logo.gif')
        .expect(422);
      const missing = await owner.put('/organization/logo', {}).expect(422);
      expect(missing.body).toMatchObject({ code: 'FILE_REQUIRED' });
      const wide = await owner
        .upload('put', '/organization/logo', png(5000, 100), 'wide.png')
        .expect(422);
      expect(wide.body).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
      const heavy = Buffer.concat([png(100, 100), Buffer.alloc(2 * 1024 * 1024)]);
      const big = await owner.upload('put', '/organization/logo', heavy, 'big.png').expect(422);
      expect(big.body).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    });

    it('is refused to a manager', async () => {
      await manager.upload('put', '/organization/logo', LOGO, 'logo.png').expect(403);
      await manager.delete('/organization/logo').expect(403);
    });

    it('stays with its own organization', async () => {
      const other = (await apiAs(t, orgB, []).get('/branding').expect(200)).body as BrandingDto;
      expect(other.logoUrl).toBeNull();
      expect(
        ((await outsider.get('/organization').expect(200)).body as OrganizationDto).logoUrl,
      ).toBeNull();
    });

    it('lets the owner remove the logo, and records it', async () => {
      const before = (await owner.get('/organization').expect(200)).body as OrganizationDto;
      const response = await owner.delete('/organization/logo').expect(200);
      expect((response.body as OrganizationDto).logoUrl).toBeNull();
      await fetchFile(orgA, before.logoUrl ?? '').expect(404);
      expect(
        ((await apiAs(t, orgA, []).get('/branding').expect(200)).body as BrandingDto).logoUrl,
      ).toBeNull();
      expect(
        await admin.auditLog.count({
          where: { organizationId: orgA.id, action: 'organization.logo.remove' },
        }),
      ).toBe(1);
      // Removing again changes nothing and records nothing.
      await owner.delete('/organization/logo').expect(200);
      expect(
        await admin.auditLog.count({
          where: { organizationId: orgA.id, action: 'organization.logo.remove' },
        }),
      ).toBe(1);
    });
  });

  describe('locations', () => {
    let locationId: string;

    it('POST /locations adds a location', async () => {
      const response = await owner
        .post('/locations', {
          name: 'Chilonzor',
          address: 'Toshkent',
          timezone: 'Asia/Tashkent',
          workingHours: WORKING_HOURS,
        })
        .expect(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        name: 'Chilonzor',
        address: 'Toshkent',
        timezone: 'Asia/Tashkent',
        workingHours: WORKING_HOURS,
        archived: false,
      });
      locationId = (response.body as { id: string }).id;
    });

    it('rejects a duplicate name', async () => {
      const response = await owner
        .post('/locations', { name: 'Chilonzor', timezone: 'Asia/Tashkent' })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'LOCATION_NAME_TAKEN' });
    });

    it('allows the same name in another organization', async () => {
      await outsider
        .post('/locations', { name: 'Chilonzor', timezone: 'Asia/Tashkent' })
        .expect(201);
    });

    it('rejects an unknown time zone and malformed hours', async () => {
      await owner.post('/locations', { name: 'X', timezone: 'Mars/Olympus' }).expect(400);
      await owner
        .post('/locations', {
          name: 'Y',
          timezone: 'Asia/Tashkent',
          workingHours: { ...WORKING_HOURS, mon: { open: '25:00', close: '26:00' } },
        })
        .expect(400);
    });

    it('is refused to a manager', async () => {
      await manager.post('/locations', { name: 'Z', timezone: 'Asia/Tashkent' }).expect(403);
      await manager.patch(`/locations/${locationId}`, { name: 'Z' }).expect(403);
    });

    it('GET /locations lists only the organization own locations', async () => {
      const response = await manager.get('/locations').expect(200);
      expect((response.body as { name: string }[]).map((row) => row.name)).toEqual(['Chilonzor']);
    });

    it('PATCH /locations/:id edits a location', async () => {
      const response = await owner
        .patch(`/locations/${locationId}`, { name: 'Chilonzor-2', workingHours: null })
        .expect(200);
      expect(response.body).toMatchObject({
        name: 'Chilonzor-2',
        address: 'Toshkent',
        workingHours: null,
      });
    });

    it("cannot edit another organization's location", async () => {
      const response = await outsider.patch(`/locations/${locationId}`, { name: 'Stolen' });
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('archives a location, hides it from the default list, and restores it', async () => {
      const archived = await owner
        .patch(`/locations/${locationId}`, { archived: true })
        .expect(200);
      expect(archived.body).toMatchObject({ archived: true });

      const visible = await owner.get('/locations').expect(200);
      expect(visible.body).toEqual([]);
      const all = await owner.get('/locations?includeArchived=true').expect(200);
      expect(all.body).toHaveLength(1);

      // Its name stays reserved, so restoring can never produce a duplicate.
      await owner
        .post('/locations', { name: 'Chilonzor-2', timezone: 'Asia/Tashkent' })
        .expect(409);

      const restored = await owner
        .patch(`/locations/${locationId}`, { archived: false })
        .expect(200);
      expect(restored.body).toMatchObject({ archived: false });
      const again = await owner.get('/locations').expect(200);
      expect(again.body).toHaveLength(1);
    });

    it('answers 400 for a malformed id', async () => {
      await owner.patch('/locations/not-a-uuid', { name: 'X' }).expect(400);
    });
  });
});
