import { PERMISSIONS, type RoleDto, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from '@gatefit/shared';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  createStaff,
  createStaffWithPermissions,
  createTestApp,
  type StaffFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization } from './support/db';

describe('Roles (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let org: Organization;
  let ownerUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  let manager: ReturnType<typeof apiAs>;
  /** May manage roles, but holds few permissions otherwise. */
  let hr: ReturnType<typeof apiAs>;

  const listRoles = async (as = owner): Promise<RoleDto[]> =>
    (await as.get('/roles').expect(200)).body as RoleDto[];

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    org = await createOrganization(admin, 'A');

    ownerUser = await createStaff(admin, org, 'owner');
    owner = apiAs(t, org, await cookiesFor(t, org, ownerUser));
    manager = apiAs(t, org, await cookiesFor(t, org, await createStaff(admin, org, 'manager')));
    hr = apiAs(
      t,
      org,
      await cookiesFor(
        t,
        org,
        await createStaffWithPermissions(admin, org, 'hr', [
          'roles.read',
          'roles.manage',
          'staff.read',
        ]),
      ),
    );
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('GET /roles', () => {
    it('lists standard roles first, with permissions and active staff counts', async () => {
      const roles = await listRoles(manager);
      expect(roles.map((role) => role.name)).toEqual(['owner', 'manager', 'hr']);
      expect(roles[0]).toEqual({
        id: expect.any(String) as string,
        name: 'owner',
        isSystem: true,
        permissions: [...PERMISSIONS].sort(),
        staffCount: 1,
      });
      expect(roles[1]?.permissions).toEqual([...SYSTEM_ROLE_PERMISSIONS.manager].sort());
    });

    it('requires roles.read', async () => {
      const trainer = apiAs(
        t,
        org,
        await cookiesFor(t, org, await createStaff(admin, org, 'trainer')),
      );
      await trainer.get('/roles').expect(403);
    });
  });

  describe('POST /roles', () => {
    it('creates a custom role and records it', async () => {
      const response = await owner
        .post('/roles', { name: 'Cashier', permissions: ['payments.accept', 'payments.read'] })
        .expect(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        name: 'Cashier',
        isSystem: false,
        permissions: ['payments.accept', 'payments.read'],
        staffCount: 0,
      });

      const role = response.body as RoleDto;
      const entry = await admin.auditLog.findFirstOrThrow({
        where: { organizationId: org.id, action: 'role.create', entityId: role.id },
      });
      expect(entry).toMatchObject({ actorId: ownerUser.userId, entity: 'role' });
      expect(entry.after).toEqual({
        name: 'Cashier',
        permissions: ['payments.accept', 'payments.read'],
      });
    });

    it('rejects a taken name, including a standard one', async () => {
      const taken = await owner.post('/roles', { name: 'Cashier', permissions: [] }).expect(409);
      expect(taken.body).toMatchObject({ code: 'ROLE_NAME_TAKEN' });
      await owner.post('/roles', { name: SYSTEM_ROLES[0], permissions: [] }).expect(409);
    });

    it('rejects an unknown permission', async () => {
      await owner.post('/roles', { name: 'Bad', permissions: ['everything.all'] }).expect(400);
    });

    it('requires roles.manage', async () => {
      await manager.post('/roles', { name: 'Mine', permissions: [] }).expect(403);
    });

    it('cannot grant permissions the caller does not hold', async () => {
      const response = await hr
        .post('/roles', { name: 'Backdoor', permissions: ['payments.refund'] })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'PERMISSION_ESCALATION' });

      await hr.post('/roles', { name: 'Within limits', permissions: ['staff.read'] }).expect(201);
    });
  });

  describe('PATCH /roles/:id', () => {
    const idOf = async (name: string) => {
      const role = (await listRoles()).find((candidate) => candidate.name === name);
      if (!role) {
        throw new Error(`No role named ${name}`);
      }
      return role.id;
    };

    it('renames a role and replaces its permissions, recording before and after', async () => {
      const id = await idOf('Cashier');
      const response = await owner
        .patch(`/roles/${id}`, {
          name: 'Till',
          permissions: ['payments.accept', 'cash_shifts.manage'],
        })
        .expect(200);
      expect(response.body).toMatchObject({
        name: 'Till',
        permissions: ['cash_shifts.manage', 'payments.accept'],
      });

      const entry = await admin.auditLog.findFirstOrThrow({
        where: { organizationId: org.id, action: 'role.update', entityId: id },
      });
      expect(entry.before).toEqual({
        name: 'Cashier',
        permissions: ['payments.accept', 'payments.read'],
      });
      expect(entry.after).toEqual({
        name: 'Till',
        permissions: ['cash_shifts.manage', 'payments.accept'],
      });
    });

    it('takes effect for holders of the role on their next request', async () => {
      const greeter = await createStaffWithPermissions(admin, org, 'Greeter', [
        'organization.read',
      ]);
      const asGreeter = apiAs(t, org, await cookiesFor(t, org, greeter));
      await asGreeter.get('/staff').expect(403);

      await owner
        .patch(`/roles/${greeter.roleId}`, { permissions: ['organization.read', 'staff.read'] })
        .expect(200);
      await asGreeter.get('/staff').expect(200);
    });

    it('refuses to change a standard role', async () => {
      const response = await owner
        .patch(`/roles/${await idOf('manager')}`, { permissions: [] })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'SYSTEM_ROLE_IMMUTABLE' });
    });

    it('cannot raise a role above the caller, nor edit a role above the caller', async () => {
      const within = await idOf('Within limits');
      const raise = await hr
        .patch(`/roles/${within}`, { permissions: ['staff.manage'] })
        .expect(403);
      expect(raise.body).toMatchObject({ code: 'PERMISSION_ESCALATION' });

      // "Till" holds payment permissions that hr lacks: hr may not even rename it.
      await hr.patch(`/roles/${await idOf('Till')}`, { name: 'Renamed' }).expect(403);
    });

    it('refuses to archive a role that staff still hold', async () => {
      const response = await owner
        .patch(`/roles/${await idOf('hr')}`, { archived: true })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'ROLE_IN_USE' });
    });

    it('archives an unused role', async () => {
      const id = await idOf('Till');
      await owner.patch(`/roles/${id}`, { archived: true }).expect(200);

      expect((await listRoles()).map((role) => role.name)).not.toContain('Till');
      await owner.patch(`/roles/${id}`, { name: 'Back' }).expect(404);
    });

    it("cannot touch another organization's role", async () => {
      const other = await createOrganization(admin, 'B');
      const foreign = await createStaffWithPermissions(admin, other, 'Foreign', []);
      await owner.patch(`/roles/${foreign.roleId}`, { name: 'Stolen' }).expect(404);
    });
  });
});
