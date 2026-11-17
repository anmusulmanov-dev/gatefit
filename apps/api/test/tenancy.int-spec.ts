import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenancyContext } from '../src/common/tenancy/tenancy-context';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Location, Organization, PrismaClient, Role } from '../src/generated/prisma/client';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

const RLS_VIOLATION = /row-level security/;
const PERMISSION_DENIED = /permission denied/;

// Stage 0 exit criterion: two organizations cannot see each other's data.
describe('Tenant isolation (integration)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let tenantDb: TenantDb;
  let prisma: PrismaService;

  let orgA: Organization;
  let orgB: Organization;
  let locationA: Location;
  let locationB: Location;
  let roleA: Role;
  let roleB: Role;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantDb = app.get(TenantDb);
    prisma = app.get(PrismaService);

    admin = createAdminClient();
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');
    const location = (organizationId: string, name: string) =>
      admin.location.create({ data: { organizationId, name, timezone: 'Asia/Tashkent' } });
    const role = (organizationId: string) =>
      admin.role.create({ data: { organizationId, name: 'manager', isSystem: true } });
    [locationA, locationB, roleA, roleB] = await Promise.all([
      location(orgA.id, 'A main'),
      location(orgB.id, 'B main'),
      role(orgA.id),
      role(orgB.id),
    ]);
  });

  afterAll(async () => {
    await admin.$disconnect();
    await app.close();
  });

  describe('reading', () => {
    it('lists only rows of the current organization', async () => {
      const [locations, roles, organizations] = await tenantDb.run(orgA.id, (tx) =>
        Promise.all([tx.location.findMany(), tx.role.findMany(), tx.organization.findMany()]),
      );
      expect(locations.map((row) => row.id)).toEqual([locationA.id]);
      expect(roles.map((row) => row.id)).toEqual([roleA.id]);
      expect(organizations.map((row) => row.id)).toEqual([orgA.id]);
    });

    it("cannot fetch another organization's row by id", async () => {
      const [location, organization] = await tenantDb.run(orgA.id, (tx) =>
        Promise.all([
          tx.location.findUnique({ where: { id: locationB.id } }),
          tx.organization.findUnique({ where: { id: orgB.id } }),
        ]),
      );
      expect(location).toBeNull();
      expect(organization).toBeNull();
    });

    it('sees nothing without a tenant context', async () => {
      await expect(prisma.location.findMany()).resolves.toEqual([]);
      await expect(prisma.organization.findMany()).resolves.toEqual([]);
    });

    it('rejects a malformed organization id before touching the database', async () => {
      await expect(tenantDb.run('not-a-uuid', (tx) => tx.location.findMany())).rejects.toThrow();
    });
  });

  describe('writing', () => {
    it('cannot insert a row for another organization', async () => {
      await expect(
        tenantDb.run(orgA.id, (tx) =>
          tx.location.create({
            data: { organizationId: orgB.id, name: 'Planted', timezone: 'Asia/Tashkent' },
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);

      await expect(admin.location.count({ where: { organizationId: orgB.id } })).resolves.toBe(1);
    });

    it("cannot update another organization's row", async () => {
      const result = await tenantDb.run(orgA.id, (tx) =>
        tx.location.updateMany({ where: { id: locationB.id }, data: { name: 'Hijacked' } }),
      );
      expect(result.count).toBe(0);

      const untouched = await admin.location.findUniqueOrThrow({ where: { id: locationB.id } });
      expect(untouched.name).toBe('B main');
    });

    it("cannot edit another organization's settings", async () => {
      const result = await tenantDb.run(orgA.id, (tx) =>
        tx.organization.updateMany({ where: { id: orgB.id }, data: { name: 'Hijacked' } }),
      );
      expect(result.count).toBe(0);
    });

    it('cannot hand its own row over to another organization', async () => {
      await expect(
        tenantDb.run(orgA.id, (tx) =>
          tx.location.update({ where: { id: locationA.id }, data: { organizationId: orgB.id } }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
    });

    it("cannot delete another organization's rows", async () => {
      await admin.rolePermission.create({
        data: { organizationId: orgB.id, roleId: roleB.id, permission: 'members.read' },
      });

      const result = await tenantDb.run(orgA.id, (tx) =>
        tx.rolePermission.deleteMany({ where: { roleId: roleB.id } }),
      );
      expect(result.count).toBe(0);
      await expect(admin.rolePermission.count({ where: { roleId: roleB.id } })).resolves.toBe(1);
    });

    it("cannot link its own row to another organization's row", async () => {
      const user = await admin.user.create({ data: { phone: uniquePhone() } });

      // The composite foreign key (organization_id, role_id) has no match in organization A.
      await expect(
        tenantDb.run(orgA.id, (tx) =>
          tx.staff.create({
            data: {
              organizationId: orgA.id,
              userId: user.id,
              roleId: roleB.id,
              firstName: 'Cross',
              lastName: 'Tenant',
            },
          }),
        ),
      ).rejects.toThrow();
      await expect(admin.staff.count({ where: { userId: user.id } })).resolves.toBe(0);
    });

    it('rolls everything back when the work throws', async () => {
      const name = `Rolled back ${randomUUID()}`;
      await expect(
        tenantDb.run(orgA.id, async (tx) => {
          await tx.location.create({
            data: { organizationId: orgA.id, name, timezone: 'Asia/Tashkent' },
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      await expect(admin.location.count({ where: { name } })).resolves.toBe(0);
    });
  });

  describe('context', () => {
    it('does not leak to the next query on the same pool', async () => {
      await tenantDb.run(orgA.id, (tx) => tx.location.findMany());
      await expect(prisma.location.findMany()).resolves.toEqual([]);
    });

    it('keeps concurrent organizations apart', async () => {
      const seen = await Promise.all(
        Array.from({ length: 20 }, (_, index) => {
          const organization = index % 2 === 0 ? orgA : orgB;
          return tenantDb.run(organization.id, async (tx) => {
            const rows = await tx.location.findMany();
            return { expected: organization.id, actual: rows.map((row) => row.organizationId) };
          });
        }),
      );
      for (const { expected, actual } of seen) {
        expect(actual).toEqual([expected]);
      }
    });

    it('exposes the transaction to nested code and only inside run()', async () => {
      await tenantDb.run(orgA.id, async (tx) => {
        await Promise.resolve();
        expect(tenantDb.tx).toBe(tx);
        expect(TenancyContext.require().organizationId).toBe(orgA.id);
      });
      expect(() => tenantDb.tx).toThrow(/No tenant context/);
    });
  });

  describe('privileges of the API role', () => {
    it('cannot hard-delete business rows', async () => {
      await expect(
        tenantDb.run(orgA.id, (tx) => tx.location.deleteMany({ where: { id: locationA.id } })),
      ).rejects.toThrow(PERMISSION_DENIED);
    });

    it('cannot create organizations', async () => {
      await expect(
        tenantDb.run(orgA.id, (tx) =>
          tx.organization.create({
            data: {
              name: 'Rogue',
              slug: `rogue-${randomUUID()}`,
              country: 'UZ',
              currency: 'UZS',
              locale: 'uz',
            },
          }),
        ),
      ).rejects.toThrow(PERMISSION_DENIED);
    });
  });

  describe('audit_logs', () => {
    const entry = (organizationId: string) => ({
      organizationId,
      action: 'location.update',
      entity: 'location',
      after: { name: 'New' },
    });

    it('accepts inserts and shows them only to their organization', async () => {
      const created = await tenantDb.run(orgA.id, (tx) =>
        tx.auditLog.create({ data: entry(orgA.id) }),
      );

      const [ownView, foreignView] = await Promise.all([
        tenantDb.run(orgA.id, (tx) => tx.auditLog.findMany({ where: { id: created.id } })),
        tenantDb.run(orgB.id, (tx) => tx.auditLog.findMany({ where: { id: created.id } })),
      ]);
      expect(ownView).toHaveLength(1);
      expect(foreignView).toEqual([]);
    });

    it('cannot insert an entry for another organization', async () => {
      await expect(
        tenantDb.run(orgA.id, (tx) => tx.auditLog.create({ data: entry(orgB.id) })),
      ).rejects.toThrow(RLS_VIOLATION);
    });

    it('is append-only: no update, no delete', async () => {
      const created = await tenantDb.run(orgA.id, (tx) =>
        tx.auditLog.create({ data: entry(orgA.id) }),
      );

      await expect(
        tenantDb.run(orgA.id, (tx) =>
          tx.auditLog.updateMany({ where: { id: created.id }, data: { action: 'forged' } }),
        ),
      ).rejects.toThrow(PERMISSION_DENIED);
      await expect(
        tenantDb.run(orgA.id, (tx) => tx.auditLog.deleteMany({ where: { id: created.id } })),
      ).rejects.toThrow(PERMISSION_DENIED);
    });

    it('cannot be read around RLS through a partition', async () => {
      await expect(
        tenantDb.run(orgA.id, (tx) => tx.$queryRaw`SELECT * FROM audit_logs_default`),
      ).rejects.toThrow(PERMISSION_DENIED);
    });
  });
});
