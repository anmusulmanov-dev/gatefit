import type { MemberDto, MemberImportDto } from '@gatefit/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  createPlan,
  createStaff,
  createTestApp,
  hostOf,
  type StaffFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniqueMobile, uniquePhone } from './support/db';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 2),
]);

/** Reads a binary response body into a Buffer. */
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

async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const rows: string[][] = [];
  workbook.worksheets[0]?.eachRow((row) => {
    rows.push(
      (row.values as (string | number | null | undefined)[])
        .slice(1)
        .map((value) => (value === null || value === undefined ? '' : String(value))),
    );
  });
  return rows;
}

describe('Member photos, import and export (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let two: Location;
  let ownerUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  let receptionist: ReturnType<typeof apiAs>;
  let accountant: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;

  const create = async (overrides: object = {}): Promise<MemberDto> =>
    (
      await owner
        .post('/members', {
          firstName: 'Aziz',
          lastName: 'Karimov',
          phone: uniquePhone(),
          homeLocationId: one.id,
          ...overrides,
        })
        .expect(201)
    ).body as MemberDto;
  const fetchFile = (url: string) =>
    binary(request(t.app.getHttpServer()).get(url).set('Host', hostOf(orgA)));

  /** Waits for the background job to finish the import. */
  async function finished(as: ReturnType<typeof apiAs>, id: string): Promise<MemberImportDto> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = (await as.get(`/members/imports/${id}`).expect(200)).body as MemberImportDto;
      if (current.status === 'done' || current.status === 'failed') {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The import did not finish');
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    const plan = await createPlan(admin, 'start');
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');
    for (const organization of [orgA, orgB]) {
      await admin.organization.update({
        where: { id: organization.id },
        data: { saasPlanId: plan.id },
      });
    }
    const location = (organization: Organization, name: string) =>
      admin.location.create({
        data: { organizationId: organization.id, name, timezone: 'Asia/Tashkent' },
      });
    one = await location(orgA, 'One');
    two = await location(orgA, 'Two');

    ownerUser = await createStaff(admin, orgA, 'owner');
    const receptionistUser = await createStaff(admin, orgA, 'receptionist');
    await admin.staffLocation.create({
      data: { organizationId: orgA.id, staffId: receptionistUser.staffId, locationId: one.id },
    });
    owner = apiAs(t, orgA, await cookiesFor(t, orgA, ownerUser));
    receptionist = apiAs(t, orgA, await cookiesFor(t, orgA, receptionistUser));
    accountant = apiAs(
      t,
      orgA,
      await cookiesFor(t, orgA, await createStaff(admin, orgA, 'accountant')),
    );
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('photos', () => {
    it('stores a photo and serves it through a signed link', async () => {
      const member = await create();
      const updated = (
        await owner.upload('put', `/members/${member.id}/photo`, JPEG, 'me.jpg').expect(200)
      ).body as MemberDto;
      expect(updated.photoUrl).toMatch(/^\/api\/v1\/files\/[\w-]+\.[0-9a-f]{64}$/);
      expect(t.storage.keys()).toContainEqual(
        expect.stringMatching(new RegExp(`^orgs/${orgA.id}/members/${member.id}/photo-`)) as string,
      );

      const file = await fetchFile(updated.photoUrl ?? '').expect(200);
      expect(file.headers['content-type']).toBe('image/jpeg');
      expect(file.body).toEqual(JPEG);
    });

    it('replaces the old file and removes the photo', async () => {
      const member = await create();
      const first = (await owner.upload('put', `/members/${member.id}/photo`, JPEG, 'a.jpg'))
        .body as MemberDto;
      const second = (
        await owner.upload('put', `/members/${member.id}/photo`, PNG, 'b.png').expect(200)
      ).body as MemberDto;
      await fetchFile(first.photoUrl ?? '').expect(404);
      expect((await fetchFile(second.photoUrl ?? '').expect(200)).body).toEqual(PNG);

      const removed = (await owner.delete(`/members/${member.id}/photo`).expect(200))
        .body as MemberDto;
      expect(removed.photoUrl).toBeNull();
      await fetchFile(second.photoUrl ?? '').expect(404);
    });

    it('refuses anything but an image, whatever its name says', async () => {
      const member = await create();
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
      const response = await owner
        .upload('put', `/members/${member.id}/photo`, svg, 'photo.jpg')
        .expect(422);
      expect(response.body).toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
      const missing = await owner.put(`/members/${member.id}/photo`, {}).expect(422);
      expect(missing.body).toMatchObject({ code: 'FILE_REQUIRED' });
    });

    it('refuses a photo over 5 MB', async () => {
      const member = await create();
      const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
      const response = await owner.upload('put', `/members/${member.id}/photo`, big, 'big.jpg');
      expect([413, 422]).toContain(response.status);
      expect(response.body).toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    it('rejects forged, altered and expired links', async () => {
      const member = await create();
      const { photoUrl } = (
        await owner.upload('put', `/members/${member.id}/photo`, JPEG, 'a.jpg').expect(200)
      ).body as MemberDto;
      const url = photoUrl ?? '';
      const [payload = '', signature = ''] = url.split('/').at(-1)?.split('.') ?? [];

      const forgedPayload = Buffer.from(
        JSON.stringify({ k: t.storage.keys()[0], e: 9_999_999_999 }),
      ).toString('base64url');
      await fetchFile(`/api/v1/files/${forgedPayload}.${signature}`).expect(404);
      await fetchFile(`/api/v1/files/${payload}.${'0'.repeat(64)}`).expect(404);
      await fetchFile('/api/v1/files/garbage').expect(404);

      t.clock.advance(3 * 60 * 60);
      await fetchFile(url).expect(404);
      t.clock.reset();
    });
  });

  describe('import', () => {
    it('imports 500 members from an XLSX file without errors (acceptance criterion 1)', async () => {
      const header = ['Familiya', 'Ism', 'Telefon', "Tug'ilgan sana", 'Jins'];
      const base = 991_000_000 + Math.floor(Math.random() * 900_000);
      const rows = Array.from({ length: 500 }, (_, index) => [
        `Familiya${index}`,
        `Ism${index}`,
        // As Excel keeps phones: numbers, with the country code and without a plus.
        Number(`998${base + index}`),
        new Date(Date.UTC(1980 + (index % 30), index % 12, 1 + (index % 28))),
        index % 2 === 0 ? 'Erkak' : 'Ayol',
      ]);
      const uploaded = (
        await owner
          .upload('post', '/members/imports', await xlsx([header, ...rows]), 'members.xlsx')
          .expect(201)
      ).body as MemberImportDto;
      expect(uploaded).toMatchObject({
        status: 'uploaded',
        fileName: 'members.xlsx',
        headers: header,
        mapping: { lastName: 0, firstName: 1, phone: 2, birthDate: 3, gender: 4 },
        totalRows: 500,
      });
      expect(uploaded.sampleRows).toHaveLength(5);

      const validated = (
        await owner
          .post(`/members/imports/${uploaded.id}/validate`, {
            mapping: uploaded.mapping,
            homeLocationId: one.id,
          })
          .expect(200)
      ).body as MemberImportDto;
      expect(validated).toMatchObject({ status: 'validated', validRows: 500, errorCount: 0 });

      const queued = await owner.post(`/members/imports/${uploaded.id}/commit`).expect(202);
      expect((queued.body as MemberImportDto).status).toBe('queued');
      const done = await finished(owner, uploaded.id);
      expect(done).toMatchObject({ status: 'done', createdCount: 500, skippedCount: 0 });

      const imported = await admin.member.findMany({ where: { importId: uploaded.id } });
      expect(imported).toHaveLength(500);
      const first = imported.find((member) => member.firstName === 'Ism0');
      expect(first).toMatchObject({
        lastName: 'Familiya0',
        phone: `+998${base}`,
        gender: 'male',
        source: 'import',
        status: 'inactive',
        homeLocationId: one.id,
      });
      expect(first?.birthDate?.toISOString().slice(0, 10)).toBe('1980-01-01');
      await expect(
        admin.auditLog.findFirst({ where: { action: 'member.import', entityId: uploaded.id } }),
      ).resolves.toMatchObject({
        actorId: ownerUser.userId,
        after: expect.objectContaining({ createdCount: 500 }) as object,
      });

      // Starting it again changes nothing.
      await owner.post(`/members/imports/${uploaded.id}/commit`).expect(202);
      await expect(admin.member.count({ where: { importId: uploaded.id } })).resolves.toBe(500);
    });

    it('lists row errors from a CSV file and imports only the valid rows', async () => {
      const existing = await create({ phone: uniqueMobile() });
      const fresh = uniqueMobile();
      const csv = [
        'ФИО;Телефон;Дата рождения',
        `Rahimov Bekzod;${fresh.slice(4)};17.05.1990`,
        `Rahimova Madina;${fresh};`,
        `Solo;;31.02.1990`,
        `Yusupov Timur;${existing.phone};`,
      ].join('\r\n');
      const uploaded = (
        await owner.upload('post', '/members/imports', Buffer.from(csv), 'members.csv').expect(201)
      ).body as MemberImportDto;
      expect(uploaded.mapping).toEqual({ fullName: 0, phone: 1, birthDate: 2 });

      const validated = (
        await owner
          .post(`/members/imports/${uploaded.id}/validate`, {
            mapping: uploaded.mapping,
            homeLocationId: two.id,
          })
          .expect(200)
      ).body as MemberImportDto;
      expect(validated).toMatchObject({ validRows: 1, errorCount: 5 });
      expect(validated.errors).toEqual([
        { row: 3, field: 'phone', code: 'PHONE_REPEATED' },
        { row: 4, field: 'firstName', code: 'NAME_REQUIRED' },
        { row: 4, field: 'phone', code: 'PHONE_REQUIRED' },
        { row: 4, field: 'birthDate', code: 'BIRTH_DATE_INVALID' },
        { row: 5, field: 'phone', code: 'PHONE_EXISTS' },
      ]);

      await owner.post(`/members/imports/${uploaded.id}/commit`).expect(202);
      expect(await finished(owner, uploaded.id)).toMatchObject({ createdCount: 1 });
      const member = await admin.member.findFirstOrThrow({ where: { importId: uploaded.id } });
      expect(member).toMatchObject({ firstName: 'Bekzod', lastName: 'Rahimov', phone: fresh });
    });

    it('skips rows whose phone was taken after validation', async () => {
      const phone = uniqueMobile();
      const uploaded = (
        await owner
          .upload(
            'post',
            '/members/imports',
            Buffer.from(`Name,Phone\nKarimov Aziz,${phone}\n`),
            'm.csv',
          )
          .expect(201)
      ).body as MemberImportDto;
      await owner
        .post(`/members/imports/${uploaded.id}/validate`, {
          mapping: uploaded.mapping,
          homeLocationId: one.id,
        })
        .expect(200);
      await create({ phone });

      await owner.post(`/members/imports/${uploaded.id}/commit`).expect(202);
      expect(await finished(owner, uploaded.id)).toMatchObject({
        status: 'done',
        createdCount: 0,
        skippedCount: 1,
      });
    });

    it('checks the order of steps, the mapping and the file', async () => {
      const uploaded = (
        await owner
          .upload('post', '/members/imports', Buffer.from('Name,Phone\nA B,901234567\n'), 'm.csv')
          .expect(201)
      ).body as MemberImportDto;
      const notValidated = await owner.post(`/members/imports/${uploaded.id}/commit`).expect(409);
      expect(notValidated.body).toMatchObject({ code: 'IMPORT_NOT_VALIDATED' });

      const validate = (body: object) =>
        owner.post(`/members/imports/${uploaded.id}/validate`, { homeLocationId: one.id, ...body });
      await validate({ mapping: { fullName: 0 } }).expect(400);
      await validate({ mapping: { fullName: 0, phone: 0 } }).expect(400);
      await validate({ mapping: { fullName: 0, phone: 7 } }).expect(422);

      const garbage = await owner
        .upload('post', '/members/imports', Buffer.from([0x50, 0x4b, 0x03, 0x04, 9]), 'x.xlsx')
        .expect(422);
      expect(garbage.body).toMatchObject({ code: 'FILE_UNREADABLE' });
    });

    it('keeps imports to their organization and the staff locations', async () => {
      const managerUser = await createStaff(admin, orgA, 'manager');
      await admin.staffLocation.create({
        data: { organizationId: orgA.id, staffId: managerUser.staffId, locationId: one.id },
      });
      const manager = apiAs(t, orgA, await cookiesFor(t, orgA, managerUser));

      const uploaded = (
        await owner
          .upload(
            'post',
            '/members/imports',
            Buffer.from('Name,Phone' + String.fromCharCode(10) + 'A B,901234567'),
            'm.csv',
          )
          .expect(201)
      ).body as MemberImportDto;
      await ownerB.get(`/members/imports/${uploaded.id}`).expect(404);
      await ownerB.post(`/members/imports/${uploaded.id}/commit`).expect(404);
      // Not yet tied to a location: only whoever uploaded it sees it.
      await manager.get(`/members/imports/${uploaded.id}`).expect(404);

      await owner
        .post(`/members/imports/${uploaded.id}/validate`, {
          mapping: uploaded.mapping,
          homeLocationId: two.id,
        })
        .expect(200);
      await manager.get(`/members/imports/${uploaded.id}`).expect(404);

      const own = (
        await manager
          .upload(
            'post',
            '/members/imports',
            Buffer.from('Name,Phone' + String.fromCharCode(10) + 'A B,901234567'),
            'm.csv',
          )
          .expect(201)
      ).body as MemberImportDto;
      const elsewhere = await manager
        .post(`/members/imports/${own.id}/validate`, {
          mapping: own.mapping,
          homeLocationId: two.id,
        })
        .expect(403);
      expect(elsewhere.body).toMatchObject({ code: 'LOCATION_NOT_ASSIGNED' });
      await receptionist.get(`/members/imports/${own.id}`).expect(403);
    });

    it('serves a template whose columns are recognised on import', async () => {
      const response = await binary(owner.get('/members/imports/template')).expect(200);
      const [header = []] = await readXlsx(response.body as Buffer);
      expect(header).toEqual([
        'Familiya',
        'Ism',
        'Telefon',
        "Tug'ilgan sana",
        'Jins',
        'Izoh',
        'Favqulodda aloqa',
        'Favqulodda telefon',
      ]);
    });
  });

  describe('export', () => {
    it('exports filtered members as XLSX in the organization language, audited', async () => {
      const member = await create({
        firstName: 'Eksport',
        lastName: 'Sinov',
        birthDate: '1991-02-03',
        gender: 'female',
        homeLocationId: two.id,
      });
      const response = await binary(owner.get('/members/export?q=Eksport')).expect(200);
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="members-/);

      const rows = await readXlsx(response.body as Buffer);
      expect(rows[0]?.slice(0, 7)).toEqual([
        'Familiya',
        'Ism',
        'Telefon',
        "Tug'ilgan sana",
        'Jins',
        'Holat',
        'Filial',
      ]);
      expect(rows.slice(1).map((row) => row.slice(0, 7))).toEqual([
        ['Sinov', 'Eksport', member.phone, '1991-02-03', 'Ayol', 'Abonementsiz', 'Two'],
      ]);
      await expect(
        admin.auditLog.findFirst({
          where: { organizationId: orgA.id, action: 'member.export' },
          orderBy: { at: 'desc' },
        }),
      ).resolves.toMatchObject({ after: { format: 'xlsx', count: 1, filter: { q: 'Eksport' } } });
    });

    it('exports CSV that Excel opens and cannot run as formulas', async () => {
      await create({ firstName: '=HYPERLINK("x")', lastName: 'Csv' });
      const response = await binary(owner.get('/members/export?format=csv&q=Csv')).expect(200);
      const text = (response.body as Buffer).toString('utf8');
      expect(text.startsWith('﻿Familiya,Ism,Telefon')).toBe(true);
      expect(text).toContain(`Csv,"'=HYPERLINK(""x"")",+998`);
    });

    it('exports only what the caller may see, and needs members.export', async () => {
      const atTwo = await create({ firstName: 'Hidden', homeLocationId: two.id });
      await receptionist.get('/members/export').expect(403);

      const response = await binary(accountant.get('/members/export?format=csv')).expect(200);
      expect((response.body as Buffer).toString('utf8')).toContain(atTwo.phone);
      const fromB = await binary(ownerB.get('/members/export?format=csv')).expect(200);
      expect((fromB.body as Buffer).toString('utf8')).not.toContain(atTwo.phone);
    });
  });
});
