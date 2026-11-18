import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import { createStaff, createTestApp, type StaffFixture, type TestApp } from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

const PERMISSION_DENIED = /permission denied/;

interface Credentials {
  user_id: string;
  password_hash: string | null;
}

// users is global identity shared by every organization (docs/ADR/0002-authentication.md).
describe('users table lock-down (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let tenantDb: TenantDb;
  let prisma: PrismaService;
  let orgA: Organization;
  let orgB: Organization;
  let staffA: StaffFixture;
  let staffB: StaffFixture;

  beforeAll(async () => {
    t = await createTestApp();
    tenantDb = t.app.get(TenantDb);
    prisma = t.app.get(PrismaService);
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

  describe('direct access by the API role', () => {
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

    it('never receives credential columns', async () => {
      const [user] = await tenantDb.run(orgA.id, (tx) => tx.user.findMany());
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('totpSecret');
    });

    it('cannot read credential columns even with raw SQL', async () => {
      await expect(
        tenantDb.run(orgA.id, (tx) => tx.$queryRaw`SELECT password_hash FROM users`),
      ).rejects.toThrow(PERMISSION_DENIED);
      await expect(
        tenantDb.run(orgA.id, (tx) => tx.$queryRaw`SELECT totp_secret FROM users`),
      ).rejects.toThrow(PERMISSION_DENIED);
    });

    it('cannot insert, update or delete users', async () => {
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
  });

  describe('auth functions', () => {
    const credentials = (organization: Organization, phone: string) =>
      tenantDb.run(
        organization.id,
        (tx) => tx.$queryRaw<Credentials[]>`SELECT * FROM auth_staff_credentials(${phone}, NULL)`,
      );

    it('return credentials only for staff of the current organization', async () => {
      const own = await credentials(orgA, staffA.phone);
      expect(own).toHaveLength(1);
      expect(own[0]?.user_id).toBe(staffA.userId);
      expect(own[0]?.password_hash).toMatch(/^\$argon2id\$/);

      await expect(credentials(orgA, staffB.phone)).resolves.toEqual([]);
    });

    it('return nothing without a tenant context', async () => {
      await expect(
        prisma.$queryRaw`SELECT * FROM auth_staff_credentials(${staffA.phone}, NULL)`,
      ).resolves.toEqual([]);
    });

    it('cannot be used to list users', async () => {
      await expect(
        tenantDb.run(
          orgA.id,
          (tx) => tx.$queryRaw`SELECT * FROM auth_staff_credentials(NULL, NULL)`,
        ),
      ).resolves.toEqual([]);
    });

    it('refuse to create users without a tenant context', async () => {
      await expect(
        prisma.$queryRaw`SELECT auth_find_or_create_user(${randomUUID()}::uuid, ${uniquePhone()})`,
      ).rejects.toThrow(/tenant context/);
    });

    it("enrol TOTP only for the current organization's staff and never overwrite it", async () => {
      const enroll = (organization: Organization, userId: string, secret: string) =>
        tenantDb.run(organization.id, async (tx) => {
          const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
            SELECT auth_enroll_totp(${userId}::uuid, ${secret}) AS ok`;
          return row?.ok;
        });

      await expect(enroll(orgA, staffB.userId, 'planted')).resolves.toBe(false);
      await expect(enroll(orgA, staffA.userId, 'first')).resolves.toBe(true);
      await expect(enroll(orgA, staffA.userId, 'second')).resolves.toBe(false);

      const [a, b] = await Promise.all([
        admin.user.findUniqueOrThrow({ where: { id: staffA.userId } }),
        admin.user.findUniqueOrThrow({ where: { id: staffB.userId } }),
      ]);
      expect(a.totpSecret).toBe('first');
      expect(b.totpSecret).toBeNull();
    });
  });
});
