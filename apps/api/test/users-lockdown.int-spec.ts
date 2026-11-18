import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import { StaffCredentialsService } from '../src/modules/staff/staff-credentials.service';
import { createStaff, createTestApp, type StaffFixture, type TestApp } from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

const PERMISSION_DENIED = /permission denied/;

// users is global identity shared by every organization; credentials live on staff, inside
// the organization (docs/ADR/0002-authentication.md, docs/ADR/0003-staff-credentials.md).
describe('Identity and credentials isolation (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let tenantDb: TenantDb;
  let prisma: PrismaService;
  let credentials: StaffCredentialsService;
  let orgA: Organization;
  let orgB: Organization;
  let staffA: StaffFixture;
  let staffB: StaffFixture;

  beforeAll(async () => {
    t = await createTestApp();
    tenantDb = t.app.get(TenantDb);
    prisma = t.app.get(PrismaService);
    credentials = t.app.get(StaffCredentialsService);
    admin = createAdminClient();
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');
    staffA = await createStaff(admin, orgA, 'manager');
    staffB = await createStaff(admin, orgB, 'manager');
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('users table', () => {
    it('lists only users linked to the current organization', async () => {
      const users = await tenantDb.run(orgA.id, (tx) => tx.user.findMany());
      expect(users.map((user) => user.id)).toEqual([staffA.userId]);
    });

    it("cannot look up another organization's user, by id or by phone", async () => {
      const found = await tenantDb.run(orgA.id, (tx) =>
        Promise.all([
          tx.user.findUnique({ where: { id: staffB.userId } }),
          tx.user.findUnique({ where: { phone: staffB.phone } }),
        ]),
      );
      expect(found).toEqual([null, null]);
    });

    it('sees no users at all without a tenant context', async () => {
      await expect(prisma.user.findMany()).resolves.toEqual([]);
    });

    it('cannot be written by the API role', async () => {
      await expect(
        tenantDb.run(
          orgA.id,
          (tx) =>
            tx.$executeRaw`INSERT INTO users (id, phone, updated_at) VALUES (${randomUUID()}::uuid, ${uniquePhone()}, now())`,
        ),
      ).rejects.toThrow(PERMISSION_DENIED);
      await expect(
        tenantDb.run(
          orgA.id,
          (tx) =>
            tx.$executeRaw`UPDATE users SET phone = ${uniquePhone()} WHERE id = ${staffA.userId}::uuid`,
        ),
      ).rejects.toThrow(PERMISSION_DENIED);
      await expect(
        tenantDb.run(
          orgA.id,
          (tx) => tx.$executeRaw`DELETE FROM users WHERE id = ${staffA.userId}::uuid`,
        ),
      ).rejects.toThrow(PERMISSION_DENIED);
    });

    it('gains new rows only through auth_find_or_create_user, inside a tenant context', async () => {
      await expect(
        prisma.$queryRaw`SELECT auth_find_or_create_user(${randomUUID()}::uuid, ${uniquePhone()})`,
      ).rejects.toThrow(/tenant context/);
    });
  });

  describe('staff credentials', () => {
    it('never ride along with ordinary staff queries', async () => {
      const [staff] = await tenantDb.run(orgA.id, (tx) => tx.staff.findMany());
      expect(staff).toBeDefined();
      expect(staff).not.toHaveProperty('passwordHash');
      expect(staff).not.toHaveProperty('totpSecret');
    });

    it('are found only for staff of the current organization', async () => {
      const own = await tenantDb.run(orgA.id, (tx) => credentials.findByPhone(tx, staffA.phone));
      expect(own).toMatchObject({ staffId: staffA.staffId, userId: staffA.userId });
      expect(own?.passwordHash).toMatch(/^\$argon2id\$/);

      const foreign = await tenantDb.run(orgA.id, (tx) =>
        Promise.all([
          credentials.findByPhone(tx, staffB.phone),
          credentials.findByUserId(tx, staffB.userId),
        ]),
      );
      expect(foreign).toEqual([null, null]);
    });

    it("cannot be read from another organization's rows even with raw SQL", async () => {
      const rows = await tenantDb.run(
        orgA.id,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`SELECT id FROM staff WHERE password_hash IS NOT NULL`,
      );
      expect(rows.map((row) => row.id)).toEqual([staffA.staffId]);
    });

    it('are independent per organization for one person', async () => {
      // The same person (one users row) also works at organization B.
      const role = await admin.role.findFirstOrThrow({ where: { organizationId: orgB.id } });
      const second = await admin.staff.create({
        data: {
          organizationId: orgB.id,
          userId: staffA.userId,
          roleId: role.id,
          firstName: 'Same',
          lastName: 'Person',
          passwordHash: 'hash-at-b',
        },
      });

      // Organization A replaces the password of its own staff record...
      await tenantDb.run(orgA.id, (tx) =>
        credentials.setPassword(tx, staffA.staffId, 'new-hash-at-a', true),
      );

      // ...and the record at organization B is untouched.
      const atB = await admin.staff.findUniqueOrThrow({ where: { id: second.id } });
      expect(atB.passwordHash).toBe('hash-at-b');
      expect(atB.mustChangePassword).toBe(false);
    });

    it('enrol an authenticator once and never overwrite it', async () => {
      const enroll = (secret: string) =>
        tenantDb.run(orgA.id, (tx) => credentials.enrollTotp(tx, staffA.staffId, secret));

      await expect(enroll('first')).resolves.toBe(true);
      await expect(enroll('second')).resolves.toBe(false);

      const stored = await admin.staff.findUniqueOrThrow({ where: { id: staffA.staffId } });
      expect(stored.totpSecret).toBe('first');
    });

    it("cannot be changed for another organization's staff", async () => {
      await expect(
        tenantDb.run(orgA.id, (tx) =>
          credentials.setPassword(tx, staffB.staffId, 'planted', false),
        ),
      ).rejects.toThrow();
      await expect(
        tenantDb.run(orgA.id, (tx) => credentials.enrollTotp(tx, staffB.staffId, 'planted')),
      ).resolves.toBe(false);

      const untouched = await admin.staff.findUniqueOrThrow({ where: { id: staffB.staffId } });
      expect(untouched.passwordHash).toMatch(/^\$argon2id\$/);
      expect(untouched.totpSecret).toBeNull();
    });
  });
});
