import { type Page, PERMISSIONS, type StaffDto } from '@gatefit/shared';
import request from 'supertest';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  cookiesFrom,
  createStaff,
  createStaffWithPermissions,
  createTestApp,
  hostOf,
  type StaffFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

const TEMP_PASSWORD = 'temporary-pass-1';

describe('Staff (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let ownerUser: StaffFixture;
  let managerUser: StaffFixture;
  let hrUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  /** Holds staff.manage but far fewer permissions than a manager or an owner. */
  let hr: ReturnType<typeof apiAs>;
  let roleIds: Record<'owner' | 'manager' | 'receptionist' | 'trainer', string>;
  let locationIds: string[];

  const login = (organization: Organization, body: object) =>
    request(t.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Host', hostOf(organization))
      .send(body);
  const newStaff = (overrides: object = {}) => ({
    phone: uniquePhone(),
    firstName: 'Aziz',
    lastName: 'Karimov',
    position: 'Front desk',
    roleId: roleIds.receptionist,
    locationIds,
    temporaryPassword: TEMP_PASSWORD,
    ...overrides,
  });
  const auditOf = (action: string, entityId: string) =>
    admin.auditLog.findFirst({ where: { organizationId: orgA.id, action, entityId } });

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');

    ownerUser = await createStaff(admin, orgA, 'owner');
    managerUser = await createStaff(admin, orgA, 'manager');
    const receptionist = await createStaff(admin, orgA, 'receptionist');
    const trainer = await createStaff(admin, orgA, 'trainer');
    hrUser = await createStaffWithPermissions(admin, orgA, 'hr', [
      'staff.read',
      'staff.manage',
      'organization.read',
      'locations.read',
    ]);
    roleIds = {
      owner: ownerUser.roleId,
      manager: managerUser.roleId,
      receptionist: receptionist.roleId,
      trainer: trainer.roleId,
    };
    const locations = await Promise.all(
      ['One', 'Two'].map((name) =>
        admin.location.create({
          data: { organizationId: orgA.id, name, timezone: 'Asia/Tashkent' },
        }),
      ),
    );
    locationIds = locations.map((location) => location.id);

    owner = apiAs(t, orgA, await cookiesFor(t, orgA, ownerUser));
    hr = apiAs(t, orgA, await cookiesFor(t, orgA, hrUser));
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('GET /staff', () => {
    it('lists staff in pages, without credentials', async () => {
      const first = (await owner.get('/staff?limit=2').expect(200)).body as Page<StaffDto>;
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBe(first.items[1]?.id);
      expect(first.items[0]).toEqual({
        id: ownerUser.staffId,
        phone: ownerUser.phone,
        firstName: 'Test',
        lastName: 'owner',
        position: null,
        status: 'active',
        role: { id: roleIds.owner, name: 'owner', isSystem: true },
        locations: [],
        totpEnabled: false,
        mustChangePassword: false,
      });

      const rest = (await owner.get(`/staff?limit=100&cursor=${first.nextCursor}`).expect(200))
        .body as Page<StaffDto>;
      expect(rest.nextCursor).toBeNull();
      const everyone = [...first.items, ...rest.items].map((staff) => staff.id);
      expect(new Set(everyone).size).toBe(5);
    });

    it('filters by status', async () => {
      const inactive = (await owner.get('/staff?status=inactive').expect(200))
        .body as Page<StaffDto>;
      expect(inactive.items).toEqual([]);
    });

    it('rejects a malformed page request', async () => {
      await owner.get('/staff?limit=1000').expect(400);
      await owner.get('/staff?cursor=nope').expect(400);
    });

    it("never shows another organization's staff", async () => {
      await createStaff(admin, orgB, 'manager');
      const page = (await owner.get('/staff').expect(200)).body as Page<StaffDto>;
      expect(page.items).toHaveLength(5);
    });

    it('requires staff.read', async () => {
      const trainer = await createStaff(admin, orgA, 'trainer');
      await apiAs(t, orgA, await cookiesFor(t, orgA, trainer))
        .get('/staff')
        .expect(403);
    });
  });

  describe('POST /staff', () => {
    it('adds a staff member who must replace the temporary password before signing in', async () => {
      const input = newStaff();
      const created = (await owner.post('/staff', input).expect(201)).body as StaffDto;
      expect(created).toMatchObject({
        phone: input.phone,
        firstName: 'Aziz',
        lastName: 'Karimov',
        position: 'Front desk',
        status: 'active',
        role: { name: 'receptionist' },
        totpEnabled: false,
        mustChangePassword: true,
      });
      expect(created.locations.map((location) => location.name).sort()).toEqual(['One', 'Two']);
      await expect(auditOf('staff.create', created.id)).resolves.toMatchObject({
        actorId: ownerUser.userId,
        after: { roleId: roleIds.receptionist, locationIds },
      });

      // The temporary password proves identity but opens no session.
      const refused = await login(orgA, { phone: input.phone, password: TEMP_PASSWORD }).expect(
        403,
      );
      expect(refused.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
      expect(refused.headers['set-cookie']).toBeUndefined();
      const { changeToken } = (refused.body as { details: { changeToken: string } }).details;

      const setPassword = (newPassword: string) =>
        request(t.app.getHttpServer())
          .post('/api/v1/auth/password/set')
          .set('Host', hostOf(orgA))
          .send({ changeToken, newPassword });

      const same = await setPassword(TEMP_PASSWORD).expect(422);
      expect(same.body).toMatchObject({ code: 'PASSWORD_UNCHANGED' });
      await setPassword('short').expect(400);
      await setPassword('my-own-password-1').expect(204);
      // The change token works once.
      await setPassword('another-password-2').expect(401);

      await login(orgA, { phone: input.phone, password: TEMP_PASSWORD }).expect(401);
      await login(orgA, { phone: input.phone, password: 'my-own-password-1' }).expect(204);
    });

    it('rejects a change token at another organization', async () => {
      const input = newStaff();
      await owner.post('/staff', input).expect(201);
      const refused = await login(orgA, { phone: input.phone, password: TEMP_PASSWORD });
      const { changeToken } = (refused.body as { details: { changeToken: string } }).details;

      await request(t.app.getHttpServer())
        .post('/api/v1/auth/password/set')
        .set('Host', hostOf(orgB))
        .send({ changeToken, newPassword: 'my-own-password-1' })
        .expect(401);
    });

    it('rejects a phone that is already on the staff', async () => {
      const response = await owner
        .post('/staff', newStaff({ phone: managerUser.phone }))
        .expect(409);
      expect(response.body).toMatchObject({ code: 'STAFF_EXISTS' });
    });

    it('reuses the identity of someone who works elsewhere, with separate credentials', async () => {
      const elsewhere = await createStaff(admin, orgB, 'manager');
      const created = (await owner.post('/staff', newStaff({ phone: elsewhere.phone })).expect(201))
        .body as StaffDto;

      const record = await admin.staff.findUniqueOrThrow({ where: { id: created.id } });
      expect(record.userId).toBe(elsewhere.userId);

      // Their password at the other organization is untouched and still works there.
      await login(orgB, { phone: elsewhere.phone, password: elsewhere.password }).expect(204);
      await login(orgB, { phone: elsewhere.phone, password: TEMP_PASSWORD }).expect(401);
    });

    it('rejects a role or location that does not exist here', async () => {
      const foreignRole = await createStaff(admin, orgB, 'trainer');
      const badRole = await owner
        .post('/staff', newStaff({ roleId: foreignRole.roleId }))
        .expect(422);
      expect(badRole.body).toMatchObject({
        code: 'INVALID_REFERENCE',
        details: { field: 'roleId' },
      });

      const foreignLocation = await admin.location.create({
        data: { organizationId: orgB.id, name: 'Foreign', timezone: 'Asia/Tashkent' },
      });
      const badLocation = await owner
        .post('/staff', newStaff({ locationIds: [foreignLocation.id] }))
        .expect(422);
      expect(badLocation.body).toMatchObject({ details: { field: 'locationIds' } });
    });

    it('rejects malformed input', async () => {
      await owner.post('/staff', newStaff({ phone: '123' })).expect(400);
      await owner.post('/staff', newStaff({ firstName: '' })).expect(400);
      await owner.post('/staff', newStaff({ temporaryPassword: 'short' })).expect(400);
    });

    it('cannot hand out a role more powerful than the caller', async () => {
      const response = await hr.post('/staff', newStaff({ roleId: roleIds.owner })).expect(403);
      expect(response.body).toMatchObject({ code: 'PERMISSION_ESCALATION' });

      await hr.post('/staff', newStaff({ roleId: hrUser.roleId })).expect(201);
    });

    it('requires staff.manage', async () => {
      const manager = apiAs(t, orgA, await cookiesFor(t, orgA, managerUser));
      await manager.post('/staff', newStaff()).expect(403);
    });
  });

  describe('PATCH /staff/:id', () => {
    let target: StaffDto;

    beforeAll(async () => {
      target = (await owner.post('/staff', newStaff()).expect(201)).body as StaffDto;
    });

    it('edits the profile, role and locations, recording the permission change', async () => {
      const response = await owner
        .patch(`/staff/${target.id}`, {
          firstName: 'Bobur',
          position: null,
          roleId: roleIds.trainer,
          locationIds: [locationIds[0]],
        })
        .expect(200);
      expect(response.body).toMatchObject({
        firstName: 'Bobur',
        lastName: 'Karimov',
        position: null,
        role: { name: 'trainer' },
        locations: [{ id: locationIds[0], name: 'One' }],
      });

      await expect(auditOf('staff.update', target.id)).resolves.toMatchObject({
        before: { roleId: roleIds.receptionist, status: 'active' },
        after: { roleId: roleIds.trainer, status: 'active', locationIds: [locationIds[0]] },
      });
    });

    it('deactivating ends their access at once', async () => {
      const victim = await createStaff(admin, orgA, 'trainer');
      const asVictim = apiAs(t, orgA, await cookiesFor(t, orgA, victim));
      await asVictim.get('/me').expect(200);

      await owner.patch(`/staff/${victim.staffId}`, { status: 'inactive' }).expect(200);
      await asVictim.get('/me').expect(401);
      await login(orgA, { phone: victim.phone, password: victim.password }).expect(401);

      const inactive = (await owner.get('/staff?status=inactive').expect(200))
        .body as Page<StaffDto>;
      expect(inactive.items.map((staff) => staff.id)).toEqual([victim.staffId]);
    });

    it('lets staff edit their own name but not their own role or status', async () => {
      await owner.patch(`/staff/${ownerUser.staffId}`, { firstName: 'Renamed' }).expect(200);

      const role = await owner.patch(`/staff/${ownerUser.staffId}`, { roleId: roleIds.manager });
      expect(role.status).toBe(403);
      expect(role.body).toMatchObject({ code: 'CANNOT_MODIFY_SELF' });
      await owner.patch(`/staff/${ownerUser.staffId}`, { status: 'inactive' }).expect(403);
    });

    it('cannot change someone whose role is more powerful than the caller', async () => {
      const demote = await hr.patch(`/staff/${managerUser.staffId}`, { roleId: hrUser.roleId });
      expect(demote.status).toBe(403);
      expect(demote.body).toMatchObject({ code: 'PERMISSION_ESCALATION' });
      await hr.patch(`/staff/${managerUser.staffId}`, { status: 'inactive' }).expect(403);

      // ...nor promote anyone, including an accomplice, above themselves.
      await hr.patch(`/staff/${target.id}`, { roleId: roleIds.owner }).expect(403);
    });

    it('keeps at least one active owner', async () => {
      // Someone with every permission who is not an owner tries to remove the only owner.
      const almighty = await createStaffWithPermissions(admin, orgA, 'almighty', [...PERMISSIONS]);
      const asAlmighty = apiAs(t, orgA, await cookiesFor(t, orgA, almighty));

      const demote = await asAlmighty.patch(`/staff/${ownerUser.staffId}`, {
        roleId: roleIds.manager,
      });
      expect(demote.status).toBe(409);
      expect(demote.body).toMatchObject({ code: 'LAST_OWNER' });
      await asAlmighty.patch(`/staff/${ownerUser.staffId}`, { status: 'inactive' }).expect(409);

      // With a second owner in place the first one can step down.
      const second = await createStaff(admin, orgA, 'owner');
      await asAlmighty
        .patch(`/staff/${ownerUser.staffId}`, { roleId: roleIds.manager })
        .expect(200);
      await asAlmighty.patch(`/staff/${second.staffId}`, { status: 'inactive' }).expect(409);

      // Restore for the tests below.
      await admin.staff.update({
        where: { id: ownerUser.staffId },
        data: { roleId: roleIds.owner },
      });
    });

    it("answers 404 for another organization's staff member", async () => {
      const foreign = await createStaff(admin, orgB, 'trainer');
      await owner.patch(`/staff/${foreign.staffId}`, { firstName: 'Stolen' }).expect(404);
    });
  });

  describe('POST /staff/:id/reset-password', () => {
    it('gives a temporary password, signs the person out and records it', async () => {
      const victim = await createStaff(admin, orgA, 'receptionist');
      const asVictim = apiAs(t, orgA, await cookiesFor(t, orgA, victim));
      await asVictim.get('/me').expect(200);

      await owner
        .post(`/staff/${victim.staffId}/reset-password`, { temporaryPassword: TEMP_PASSWORD })
        .expect(204);

      await asVictim.get('/me').expect(401);
      await login(orgA, { phone: victim.phone, password: victim.password }).expect(401);
      const next = await login(orgA, { phone: victim.phone, password: TEMP_PASSWORD }).expect(403);
      expect(next.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });

      const entry = await auditOf('staff.password_reset', victim.staffId);
      expect(entry).toMatchObject({ actorId: ownerUser.userId, before: null, after: null });
    });

    it("refuses to reset an owner's password, even for another owner", async () => {
      const secondOwner = await createStaff(admin, orgA, 'owner');
      const response = await owner
        .post(`/staff/${secondOwner.staffId}/reset-password`, { temporaryPassword: TEMP_PASSWORD })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'PERMISSION_ESCALATION' });
      await login(orgA, { phone: secondOwner.phone, password: TEMP_PASSWORD }).expect(401);
    });

    it('refuses to reset your own password this way', async () => {
      const response = await hr
        .post(`/staff/${hrUser.staffId}/reset-password`, { temporaryPassword: TEMP_PASSWORD })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'CANNOT_MODIFY_SELF' });
    });

    it('refuses to reset someone more powerful than the caller', async () => {
      await hr
        .post(`/staff/${managerUser.staffId}/reset-password`, { temporaryPassword: TEMP_PASSWORD })
        .expect(403);
      await login(orgA, { phone: managerUser.phone, password: managerUser.password }).expect(204);
    });

    it("answers 404 for another organization's staff member", async () => {
      const foreign = await createStaff(admin, orgB, 'trainer');
      await owner
        .post(`/staff/${foreign.staffId}/reset-password`, { temporaryPassword: TEMP_PASSWORD })
        .expect(404);
      await login(orgB, { phone: foreign.phone, password: foreign.password }).expect(204);
    });
  });

  describe('POST /staff/:id/reset-totp', () => {
    it('removes the authenticator, signs the person out and records it', async () => {
      const victim = await createStaff(admin, orgA, 'receptionist');
      await admin.staff.update({ where: { id: victim.staffId }, data: { totpSecret: 'v1.x.y.z' } });
      const asVictim = apiAs(t, orgA, await cookiesFor(t, orgA, victim));
      const before = (await owner.get('/staff?limit=100').expect(200)).body as Page<StaffDto>;
      expect(before.items.find((staff) => staff.id === victim.staffId)?.totpEnabled).toBe(true);

      await owner.post(`/staff/${victim.staffId}/reset-totp`).expect(204);

      const stored = await admin.staff.findUniqueOrThrow({ where: { id: victim.staffId } });
      expect(stored.totpSecret).toBeNull();
      await asVictim.get('/me').expect(401);
      await login(orgA, { phone: victim.phone, password: victim.password }).expect(204);
      await expect(auditOf('staff.totp_reset', victim.staffId)).resolves.toMatchObject({
        actorId: ownerUser.userId,
      });
    });

    it('is refused for an owner', async () => {
      const secondOwner = await createStaff(admin, orgA, 'owner');
      await owner.post(`/staff/${secondOwner.staffId}/reset-totp`).expect(403);
    });
  });

  describe('POST /auth/password/change', () => {
    it('changes your own password and signs out your other devices', async () => {
      const me = await createStaff(admin, orgA, 'trainer');
      const thisDevice = cookiesFrom(
        await login(orgA, { phone: me.phone, password: me.password }).expect(204),
      );
      const otherDevice = cookiesFrom(
        await login(orgA, { phone: me.phone, password: me.password }).expect(204),
      );
      const here = apiAs(t, orgA, thisDevice);

      const wrong = await here
        .post('/auth/password/change', { currentPassword: 'nope', newPassword: 'brand-new-pass-1' })
        .expect(401);
      expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await here
        .post('/auth/password/change', { currentPassword: me.password, newPassword: me.password })
        .expect(422);

      await here
        .post('/auth/password/change', {
          currentPassword: me.password,
          newPassword: 'brand-new-pass-1',
        })
        .expect(204);

      await here.get('/me').expect(200);
      await apiAs(t, orgA, otherDevice).get('/me').expect(401);
      await login(orgA, { phone: me.phone, password: me.password }).expect(401);
      await login(orgA, { phone: me.phone, password: 'brand-new-pass-1' }).expect(204);
    });

    it('requires a session', async () => {
      await apiAs(t, orgA, [])
        .post('/auth/password/change', { currentPassword: 'a', newPassword: 'brand-new-pass-1' })
        .expect(401);
    });
  });
});
