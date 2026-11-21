import type { MemberDto, MemberDuplicatesDto, Page } from '@gatefit/shared';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  createPlan,
  createStaff,
  createTestApp,
  type StaffFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

describe('Members (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let two: Location;
  let ownerUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  let manager: ReturnType<typeof apiAs>;
  /** Works at location One only. */
  let receptionist: ReturnType<typeof apiAs>;
  let trainer: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;

  const newMember = (overrides: object = {}) => ({
    firstName: 'Aziz',
    lastName: 'Karimov',
    phone: uniquePhone(),
    birthDate: '1990-05-17',
    gender: 'male',
    source: 'walk_in',
    homeLocationId: one.id,
    ...overrides,
  });
  const create = async (overrides: object = {}, as = owner): Promise<MemberDto> =>
    (await as.post('/members', newMember(overrides)).expect(201)).body as MemberDto;
  const list = async (query: string, as = owner): Promise<MemberDto[]> =>
    ((await as.get(`/members?limit=100&${query}`).expect(200)).body as Page<MemberDto>).items;
  const auditOf = (action: string, entityId: string) =>
    admin.auditLog.findFirst({ where: { organizationId: orgA.id, action, entityId } });

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
    const location = (name: string) =>
      admin.location.create({ data: { organizationId: orgA.id, name, timezone: 'Asia/Tashkent' } });
    one = await location('One');
    two = await location('Two');

    ownerUser = await createStaff(admin, orgA, 'owner');
    const managerUser = await createStaff(admin, orgA, 'manager');
    const receptionistUser = await createStaff(admin, orgA, 'receptionist');
    const trainerUser = await createStaff(admin, orgA, 'trainer');
    await admin.staffLocation.createMany({
      data: [
        { organizationId: orgA.id, staffId: managerUser.staffId, locationId: one.id },
        { organizationId: orgA.id, staffId: managerUser.staffId, locationId: two.id },
        { organizationId: orgA.id, staffId: receptionistUser.staffId, locationId: one.id },
        { organizationId: orgA.id, staffId: trainerUser.staffId, locationId: one.id },
      ],
    });

    owner = apiAs(t, orgA, await cookiesFor(t, orgA, ownerUser));
    manager = apiAs(t, orgA, await cookiesFor(t, orgA, managerUser));
    receptionist = apiAs(t, orgA, await cookiesFor(t, orgA, receptionistUser));
    trainer = apiAs(t, orgA, await cookiesFor(t, orgA, trainerUser));
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('POST /members', () => {
    it('adds a member and records it in the audit log', async () => {
      const input = newMember({ notes: '  Knee injury  ', emergencyContactName: '' });
      const member = await create(input);
      expect(member).toEqual({
        id: expect.any(String) as string,
        firstName: 'Aziz',
        lastName: 'Karimov',
        phone: input.phone,
        birthDate: '1990-05-17',
        gender: 'male',
        source: 'walk_in',
        notes: 'Knee injury',
        emergencyContactName: null,
        emergencyContactPhone: null,
        status: 'inactive',
        blockedReason: null,
        homeLocation: { id: one.id, name: 'One' },
        hasPhoto: false,
        archived: false,
        createdAt: expect.any(String) as string,
      });
      await expect(auditOf('member.create', member.id)).resolves.toMatchObject({
        actorId: ownerUser.userId,
      });
    });

    it('stores the phone in international format', async () => {
      const digits = uniquePhone().slice(4);
      const member = await create({
        phone: `+998 (${digits.slice(0, 2)}) ${digits.slice(2, 5)}-${digits.slice(5)}`,
      });
      expect(member.phone).toBe(`+998${digits}`);
    });

    it('refuses a phone another member has, and says who has it', async () => {
      const existing = await create();
      const response = await owner
        .post('/members', newMember({ phone: existing.phone, firstName: 'Other' }))
        .expect(409);
      expect(response.body).toMatchObject({
        code: 'MEMBER_PHONE_TAKEN',
        details: { member: { id: existing.id, firstName: 'Aziz', archived: false } },
      });
    });

    it('refuses a birth date in the future', async () => {
      const response = await owner
        .post('/members', newMember({ birthDate: '2999-01-01' }))
        .expect(422);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('validates the input', async () => {
      await owner.post('/members', newMember({ phone: '12345' })).expect(400);
      await owner.post('/members', newMember({ firstName: ' ' })).expect(400);
      await owner.post('/members', newMember({ gender: 'other' })).expect(400);
      await owner.post('/members', newMember({ birthDate: '17.05.1990' })).expect(400);
    });

    it('refuses an unknown location or one of another organization', async () => {
      const foreign = await admin.location.create({
        data: { organizationId: orgB.id, name: 'Foreign', timezone: 'Asia/Tashkent' },
      });
      const response = await owner
        .post('/members', newMember({ homeLocationId: foreign.id }))
        .expect(422);
      expect(response.body).toMatchObject({ code: 'INVALID_REFERENCE' });
    });

    it('lets staff add members only to locations they work at', async () => {
      await create({}, receptionist);
      const response = await receptionist
        .post('/members', newMember({ homeLocationId: two.id }))
        .expect(403);
      expect(response.body).toMatchObject({ code: 'LOCATION_NOT_ASSIGNED' });
    });

    it('needs members.manage', async () => {
      const response = await trainer.post('/members', newMember()).expect(403);
      expect(response.body).toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  describe('GET /members', () => {
    it('lists members newest first, in pages', async () => {
      const older = await create();
      const newer = await create();

      const first = (await owner.get('/members?limit=1').expect(200)).body as Page<MemberDto>;
      expect(first.items.map((member) => member.id)).toEqual([newer.id]);
      const second = (await owner.get(`/members?limit=1&cursor=${first.nextCursor}`).expect(200))
        .body as Page<MemberDto>;
      expect(second.items.map((member) => member.id)).toEqual([older.id]);
    });

    it('searches by any part of a name or phone, every word must match', async () => {
      const phone = uniquePhone();
      const member = await create({ firstName: 'Shahnoza', lastName: 'Qodirova', phone });

      const ids = async (q: string) =>
        (await list(`q=${encodeURIComponent(q)}`)).map((found) => found.id);
      expect(await ids('shahno')).toEqual([member.id]);
      expect(await ids('QODIR')).toEqual([member.id]);
      expect(await ids(phone.slice(-7))).toEqual([member.id]);
      expect(await ids(`${phone.slice(-4, -2)} ${phone.slice(-2)} shahnoza`)).toContain(member.id);
      expect(await ids('Shahnoza Karimov')).toEqual([]);
    });

    it('filters by status and location', async () => {
      const atTwo = await create({ homeLocationId: two.id });
      const blocked = await create();
      await owner.post(`/members/${blocked.id}/block`, { reason: 'Rude' }).expect(200);

      expect((await list(`locationId=${two.id}`)).map((member) => member.id)).toEqual([atTwo.id]);
      const blockedIds = (await list('status=blocked')).map((member) => member.id);
      expect(blockedIds).toEqual([blocked.id]);
    });

    it("shows location-bound staff only their locations' members", async () => {
      const atTwo = await create({ homeLocationId: two.id });

      const seenByReceptionist = await list('', receptionist);
      expect(seenByReceptionist.length).toBeGreaterThan(0);
      expect(seenByReceptionist.every((member) => member.homeLocation.id === one.id)).toBe(true);
      expect(await list(`locationId=${two.id}`, receptionist)).toEqual([]);
      await receptionist.get(`/members/${atTwo.id}`).expect(404);
      await receptionist.patch(`/members/${atTwo.id}`, { firstName: 'X' }).expect(404);

      expect((await list('', manager)).map((member) => member.id)).toContain(atTwo.id);
    });

    it('needs members.read and the members module', async () => {
      await trainer.get('/members').expect(200);

      const bare = await createOrganization(admin, 'Bare');
      const bareOwner = apiAs(
        t,
        bare,
        await cookiesFor(t, bare, await createStaff(admin, bare, 'owner')),
      );
      const response = await bareOwner.get('/members').expect(403);
      expect(response.body).toMatchObject({ code: 'MODULE_NOT_AVAILABLE' });
    });
  });

  describe('GET /members/duplicates', () => {
    it('reports the member with the phone and members with the same name', async () => {
      const original = await create({ firstName: 'Davron', lastName: 'Ergashev' });
      const namesake = await create({ firstName: 'davron', lastName: 'ERGASHEV' });
      await create({ firstName: 'Davron', lastName: 'Ergashev', birthDate: '2001-01-01' });

      const query = `phone=${encodeURIComponent(original.phone)}&firstName=Davron&lastName=Ergashev&birthDate=1990-05-17`;
      const found = (await owner.get(`/members/duplicates?${query}`).expect(200))
        .body as MemberDuplicatesDto;
      expect(found.phoneMatch?.id).toBe(original.id);
      expect(found.similar.map((member) => member.id)).toEqual([namesake.id]);

      const self = (
        await owner.get(`/members/duplicates?${query}&excludeId=${original.id}`).expect(200)
      ).body as MemberDuplicatesDto;
      expect(self.phoneMatch).toBeNull();
    });
  });

  describe('PATCH /members/:id', () => {
    it('edits the profile and audits which fields changed, not their values', async () => {
      const member = await create();
      const updated = (
        await owner
          .patch(`/members/${member.id}`, { lastName: 'Karimova', gender: 'female', notes: null })
          .expect(200)
      ).body as MemberDto;
      expect(updated).toMatchObject({ lastName: 'Karimova', gender: 'female', notes: null });

      const audit = await auditOf('member.update', member.id);
      expect(audit?.after).toEqual({ fields: ['lastName', 'gender'] });
    });

    it("refuses another member's phone", async () => {
      const [first, second] = [await create(), await create()];
      const response = await owner
        .patch(`/members/${second.id}`, { phone: first.phone })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'MEMBER_PHONE_TAKEN' });
    });

    it('unlinks the member app identity when the phone changes', async () => {
      const member = await create();
      const user = await admin.user.create({ data: { phone: member.phone } });
      await admin.member.update({ where: { id: member.id }, data: { userId: user.id } });

      await owner.patch(`/members/${member.id}`, { phone: uniquePhone() }).expect(200);
      const row = await admin.member.findUniqueOrThrow({ where: { id: member.id } });
      expect(row.userId).toBeNull();
    });

    it('moves a member only to a location the caller works at', async () => {
      const member = await create();
      const response = await receptionist
        .patch(`/members/${member.id}`, { homeLocationId: two.id })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'LOCATION_NOT_ASSIGNED' });
      await manager.patch(`/members/${member.id}`, { homeLocationId: two.id }).expect(200);
    });
  });

  describe('block and unblock', () => {
    it('blocks with a reason and unblocks, both audited', async () => {
      const member = await create();
      const blocked = (
        await receptionist
          .post(`/members/${member.id}/block`, { reason: 'Unpaid locker' })
          .expect(200)
      ).body as MemberDto;
      expect(blocked).toMatchObject({ status: 'blocked', blockedReason: 'Unpaid locker' });

      const unblocked = (await receptionist.post(`/members/${member.id}/unblock`).expect(200))
        .body as MemberDto;
      expect(unblocked).toMatchObject({ status: 'inactive', blockedReason: null });

      await expect(auditOf('member.block', member.id)).resolves.toMatchObject({
        after: { status: 'blocked', reason: 'Unpaid locker' },
      });
      await expect(auditOf('member.unblock', member.id)).resolves.not.toBeNull();
    });

    it('needs a reason', async () => {
      const member = await create();
      await owner.post(`/members/${member.id}/block`, { reason: '' }).expect(400);
    });
  });

  describe('archive and restore', () => {
    it('archives: hidden from lists, phone kept, restorable', async () => {
      const member = await create();
      await receptionist.post(`/members/${member.id}/archive`).expect(403);

      const archived = (await manager.post(`/members/${member.id}/archive`).expect(200))
        .body as MemberDto;
      expect(archived.archived).toBe(true);
      expect((await list('')).map((found) => found.id)).not.toContain(member.id);
      await owner.get(`/members/${member.id}`).expect(200);

      const again = await owner.post('/members', newMember({ phone: member.phone })).expect(409);
      expect(again.body).toMatchObject({ details: { member: { id: member.id, archived: true } } });
      const edit = await owner.patch(`/members/${member.id}`, { firstName: 'X' }).expect(409);
      expect(edit.body).toMatchObject({ code: 'MEMBER_ARCHIVED' });

      await manager.post(`/members/${member.id}/restore`).expect(200);
      expect((await list('')).map((found) => found.id)).toContain(member.id);
      await expect(auditOf('member.archive', member.id)).resolves.not.toBeNull();
      await expect(auditOf('member.restore', member.id)).resolves.not.toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it("never shows one organization's members to another", async () => {
      const mine = await create();
      const theirs = (
        await ownerB
          .post('/members', {
            ...newMember({ phone: mine.phone }),
            homeLocationId: (
              await admin.location.create({
                data: { organizationId: orgB.id, name: 'B main', timezone: 'Asia/Tashkent' },
              })
            ).id,
          })
          .expect(201)
      ).body as MemberDto;

      // The same phone is a different member at each organization.
      expect(theirs.id).not.toBe(mine.id);
      expect((await list('')).map((member) => member.id)).not.toContain(theirs.id);
      await owner.get(`/members/${theirs.id}`).expect(404);
      await owner.patch(`/members/${theirs.id}`, { firstName: 'X' }).expect(404);
      await owner.post(`/members/${theirs.id}/archive`).expect(404);
      const duplicates = (
        await owner.get(`/members/duplicates?phone=${encodeURIComponent(mine.phone)}`).expect(200)
      ).body as MemberDuplicatesDto;
      expect(duplicates.phoneMatch?.id).toBe(mine.id);

      // And at the database level, under RLS.
      const seenFromA = await t.app
        .get(TenantDb)
        .run(orgA.id, (tx) => tx.member.findMany({ where: { phone: mine.phone } }));
      expect(seenFromA.map((member) => member.organizationId)).toEqual([orgA.id]);
    });
  });
});
