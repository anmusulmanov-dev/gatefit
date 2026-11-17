import {
  type OrganizationDto,
  type Page,
  PERMISSIONS,
  type PlatformOrganizationDetailDto,
  type PlatformOrganizationDto,
  SYSTEM_ROLES,
} from '@gatefit/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { PrismaClient, SaasPlan } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  createPlan,
  createPlatformAdmin,
  createTestApp,
  platformApi,
  type PlatformAdminFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, uniquePhone } from './support/db';

const TEMP_PASSWORD = 'temporary-pass-1';

describe('Platform: organizations (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let operator: PlatformAdminFixture;
  let platform: Awaited<ReturnType<typeof platformApi>>;
  let start: SaasPlan;
  let standard: SaasPlan;
  /** Marks organizations made by this file, since the test database is shared. */
  const tag = `t${randomUUID().slice(0, 6)}`;

  const newOrganization = (overrides: object = {}) => ({
    name: `${tag} Fit Club`,
    slug: `${tag}-${randomUUID().slice(0, 8)}`,
    country: 'UZ',
    currency: 'UZS',
    locale: 'uz',
    planId: start.id,
    location: { name: 'Main', timezone: 'Asia/Tashkent' },
    owner: {
      phone: uniquePhone(),
      firstName: 'Olim',
      lastName: 'Egasi',
      temporaryPassword: TEMP_PASSWORD,
    },
    ...overrides,
  });
  const create = async (overrides: object = {}) =>
    (await platform.post('/organizations', newOrganization(overrides)).expect(201))
      .body as PlatformOrganizationDetailDto;
  const login = (slug: string, body: object) =>
    request(t.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Host', `${slug}.localhost`)
      .send(body);

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    operator = await createPlatformAdmin(admin);
    platform = await platformApi(t, operator);
    start = await createPlan(admin, 'start');
    standard = await createPlan(admin, 'standard');
  });

  afterEach(() => {
    t.clock.reset();
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  it('every endpoint requires a platform session', async () => {
    const anonymous = await platformApi(t);
    await anonymous.get('/organizations').expect(401);
    await anonymous.post('/organizations', newOrganization()).expect(401);
    await anonymous.patch(`/organizations/${randomUUID()}`, { status: 'blocked' }).expect(401);
    await anonymous.get('/saas-plans').expect(401);
  });

  describe('POST /platform/organizations', () => {
    it('opens an organization that is ready to use', async () => {
      const input = newOrganization({ offerVersion: '2026-11' });
      const created = (await platform.post('/organizations', input).expect(201))
        .body as PlatformOrganizationDetailDto;

      expect(created).toMatchObject({
        name: input.name,
        slug: input.slug,
        country: 'UZ',
        currency: 'UZS',
        locale: 'uz',
        status: 'trial',
        plan: { id: start.id },
        billingPeriod: 'monthly',
        locationCount: 1,
        staffCount: 1,
        owners: [
          {
            phone: input.owner.phone,
            firstName: 'Olim',
            lastName: 'Egasi',
            status: 'active',
            totpEnabled: false,
          },
        ],
      });
      // A 14-day trial by default.
      const trialDays =
        (new Date(created.trialEndsAt ?? 0).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(trialDays).toBeGreaterThan(13.9);
      expect(trialDays).toBeLessThan(14.1);

      // The standard roles, each with exactly its permissions.
      const roles = await admin.role.findMany({
        where: { organizationId: created.id },
        include: { permissions: true },
      });
      expect(roles.map((role) => role.name).sort()).toEqual([...SYSTEM_ROLES].sort());
      const owner = roles.find((role) => role.name === 'owner');
      expect(owner?.permissions).toHaveLength(PERMISSIONS.length);

      await expect(
        admin.saasSubscription.findMany({ where: { organizationId: created.id } }),
      ).resolves.toMatchObject([{ saasPlanId: start.id, billingPeriod: 'monthly', endsAt: null }]);
      await expect(
        admin.consent.findMany({ where: { organizationId: created.id } }),
      ).resolves.toMatchObject([{ type: 'offer', version: '2026-11' }]);
      await expect(
        admin.auditLog.findFirst({
          where: { organizationId: created.id, action: 'platform.organization.create' },
        }),
      ).resolves.toMatchObject({ actorId: operator.id, entityId: created.id });

      // The owner signs in at the new address with the temporary password, replaces it,
      // and is then asked to set up an authenticator, as every owner is.
      const refused = await login(input.slug, {
        phone: input.owner.phone,
        password: TEMP_PASSWORD,
      }).expect(403);
      expect(refused.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
      const { changeToken } = (refused.body as { details: { changeToken: string } }).details;
      await request(t.app.getHttpServer())
        .post('/api/v1/auth/password/set')
        .set('Host', `${input.slug}.localhost`)
        .send({ changeToken, newPassword: 'owner-own-password-1' })
        .expect(204);
      const next = await login(input.slug, {
        phone: input.owner.phone,
        password: 'owner-own-password-1',
      }).expect(403);
      expect(next.body).toMatchObject({ code: 'TOTP_SETUP_REQUIRED' });
    });

    it('records no consent unless an offer version is given', async () => {
      const created = await create();
      await expect(admin.consent.count({ where: { organizationId: created.id } })).resolves.toBe(0);
    });

    it('can start an organization without a trial', async () => {
      const created = await create({ trialDays: 0 });
      expect(created).toMatchObject({ status: 'active', trialEndsAt: null });
    });

    it('rejects a taken or reserved address', async () => {
      const first = await create();
      const taken = await platform.post('/organizations', newOrganization({ slug: first.slug }));
      expect(taken.status).toBe(409);
      expect(taken.body).toMatchObject({ code: 'SLUG_TAKEN' });

      await platform.post('/organizations', newOrganization({ slug: 'admin' })).expect(400);
      await platform.post('/organizations', newOrganization({ slug: 'Not Valid' })).expect(400);
    });

    it('rejects an unknown or retired plan', async () => {
      const unknown = await platform.post(
        '/organizations',
        newOrganization({ planId: randomUUID() }),
      );
      expect(unknown.status).toBe(422);
      expect(unknown.body).toMatchObject({ code: 'INVALID_REFERENCE' });

      const retired = await createPlan(admin, 'pro');
      await admin.saasPlan.update({ where: { id: retired.id }, data: { isActive: false } });
      const response = await platform.post(
        '/organizations',
        newOrganization({ planId: retired.id }),
      );
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: 'PLAN_INACTIVE' });
    });

    it('creates nothing when any part fails', async () => {
      const slug = `${tag}-${randomUUID().slice(0, 8)}`;
      await platform
        .post(
          '/organizations',
          newOrganization({ slug, location: { name: 'X', timezone: 'Nowhere' } }),
        )
        .expect(400);
      await expect(admin.organization.count({ where: { slug } })).resolves.toBe(0);
    });

    it('reuses the identity of an owner who already has one', async () => {
      const phone = uniquePhone();
      const existing = await admin.user.create({ data: { phone } });
      const created = await create({ owner: { ...newOrganization().owner, phone } });

      const staff = await admin.staff.findFirstOrThrow({ where: { organizationId: created.id } });
      expect(staff.userId).toBe(existing.id);
    });
  });

  describe('GET /platform/organizations', () => {
    it('lists organizations in pages and finds them by name or address', async () => {
      const a = await create({ name: `${tag} Alpha` });
      const b = await create({ name: `${tag} Beta` });

      const found = (await platform.get(`/organizations?search=${tag}%20Al`).expect(200))
        .body as Page<PlatformOrganizationDto>;
      expect(found.items.map((item) => item.id)).toEqual([a.id]);

      const bySlug = (await platform.get(`/organizations?search=${b.slug}`).expect(200))
        .body as Page<PlatformOrganizationDto>;
      expect(bySlug.items.map((item) => item.id)).toEqual([b.id]);

      const firstPage = (await platform.get(`/organizations?search=${tag}&limit=1`).expect(200))
        .body as Page<PlatformOrganizationDto>;
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).not.toBeNull();
    });

    it('filters by status', async () => {
      const blocked = await create({ name: `${tag} Blocked` });
      await platform.patch(`/organizations/${blocked.id}`, { status: 'blocked' }).expect(200);

      const page = (await platform.get(`/organizations?search=${tag}&status=blocked`).expect(200))
        .body as Page<PlatformOrganizationDto>;
      expect(page.items.map((item) => item.id)).toEqual([blocked.id]);
    });

    it('GET /platform/organizations/:id answers 404 for an unknown organization', async () => {
      await platform.get(`/organizations/${randomUUID()}`).expect(404);
    });
  });

  describe('PATCH /platform/organizations/:id', () => {
    it('blocks an organization, which shuts its address, and unblocks it', async () => {
      const input = newOrganization();
      const created = (await platform.post('/organizations', input).expect(201))
        .body as PlatformOrganizationDetailDto;
      const credentials = { phone: input.owner.phone, password: TEMP_PASSWORD };

      await platform.patch(`/organizations/${created.id}`, { status: 'blocked' }).expect(200);
      const shut = await login(input.slug, credentials).expect(403);
      expect(shut.body).toMatchObject({ code: 'ORGANIZATION_BLOCKED' });

      await platform.patch(`/organizations/${created.id}`, { status: 'active' }).expect(200);
      const open = await login(input.slug, credentials).expect(403);
      expect(open.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });

      const entries = await admin.auditLog.findMany({
        where: { organizationId: created.id, action: 'platform.organization.update' },
        orderBy: { at: 'asc' },
      });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        actorId: operator.id,
        before: { status: 'trial' },
        after: { status: 'blocked' },
      });
    });

    it('assigns a plan and keeps the history', async () => {
      const created = await create();
      const updated = (
        await platform
          .patch(`/organizations/${created.id}`, { planId: standard.id, billingPeriod: 'yearly' })
          .expect(200)
      ).body as PlatformOrganizationDetailDto;
      expect(updated.plan).toMatchObject({ id: standard.id });
      expect(updated.billingPeriod).toBe('yearly');

      const history = await admin.saasSubscription.findMany({
        where: { organizationId: created.id },
        orderBy: { startsAt: 'asc' },
      });
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ saasPlanId: start.id, billingPeriod: 'monthly' });
      expect(history[0]?.endsAt).not.toBeNull();
      expect(history[1]).toMatchObject({
        saasPlanId: standard.id,
        billingPeriod: 'yearly',
        endsAt: null,
      });

      // Assigning the same plan again adds nothing.
      await platform.patch(`/organizations/${created.id}`, { planId: standard.id }).expect(200);
      await expect(
        admin.saasSubscription.count({ where: { organizationId: created.id } }),
      ).resolves.toBe(2);
    });

    it('sets the trial end, country and currency', async () => {
      const created = await create();
      const updated = (
        await platform
          .patch(`/organizations/${created.id}`, {
            trialEndsAt: '2027-01-31T19:00:00.000Z',
            country: 'KZ',
            currency: 'KZT',
          })
          .expect(200)
      ).body as PlatformOrganizationDetailDto;
      expect(updated).toMatchObject({
        trialEndsAt: '2027-01-31T19:00:00.000Z',
        country: 'KZ',
        currency: 'KZT',
      });
    });

    it('rejects a retired plan, malformed input and an unknown organization', async () => {
      const created = await create();
      await platform.patch(`/organizations/${created.id}`, { planId: randomUUID() }).expect(422);
      await platform.patch(`/organizations/${created.id}`, { status: 'deleted' }).expect(400);
      await platform.patch(`/organizations/${created.id}`, { currency: 'uzs' }).expect(400);
      await platform.patch(`/organizations/${created.id}`, {}).expect(400);
      await platform.patch(`/organizations/${randomUUID()}`, { status: 'blocked' }).expect(404);
    });
  });

  describe('what an organization may do about its own plan', () => {
    it('sees its plan but cannot change its plan, status or trial', async () => {
      const created = await create({ planId: standard.id });
      const organization = await admin.organization.findUniqueOrThrow({
        where: { id: created.id },
      });
      const ownerStaff = await admin.staff.findFirstOrThrow({
        where: { organizationId: created.id },
      });
      const owner = apiAs(t, organization, await cookiesFor(t, organization, ownerStaff));

      const seen = (await owner.get('/organization').expect(200)).body as OrganizationDto;
      expect(seen.plan).toMatchObject({
        key: standard.key,
        limits: { activeMembersPerLocation: 1000 },
      });
      expect(seen.plan?.modules).toContain('schedule');

      // Through the API these fields are simply not accepted...
      await owner.patch('/organization', { status: 'active', saasPlanId: start.id }).expect(400);

      // ...and the database refuses them even to a bug or an injected query.
      const tenantDb = t.app.get(TenantDb);
      await expect(
        tenantDb.run(
          created.id,
          (tx) => tx.$executeRaw`UPDATE organizations SET status = 'active', trial_ends_at = NULL`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        tenantDb.run(
          created.id,
          (tx) => tx.$executeRaw`UPDATE organizations SET saas_plan_id = ${start.id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
      const prisma = t.app.get(PrismaService);
      await expect(prisma.$executeRaw`UPDATE saas_plans SET price_minor = 0`).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('resetting staff credentials', () => {
    it("resets an owner's password, which nobody inside the organization can do", async () => {
      const input = newOrganization();
      const created = (await platform.post('/organizations', input).expect(201))
        .body as PlatformOrganizationDetailDto;
      const staffId = created.owners[0]?.staffId ?? '';
      // The owner had chosen their own password.
      await admin.staff.update({ where: { id: staffId }, data: { mustChangePassword: false } });

      await platform
        .post(`/organizations/${created.id}/staff/${staffId}/reset-password`, {
          temporaryPassword: 'reset-by-support-1',
        })
        .expect(204);

      await login(input.slug, { phone: input.owner.phone, password: TEMP_PASSWORD }).expect(401);
      const next = await login(input.slug, {
        phone: input.owner.phone,
        password: 'reset-by-support-1',
      }).expect(403);
      expect(next.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
      await expect(
        admin.auditLog.findFirst({
          where: { organizationId: created.id, action: 'platform.staff.password_reset' },
        }),
      ).resolves.toMatchObject({ actorId: operator.id, entityId: staffId });
    });

    it("removes an owner's authenticator", async () => {
      const created = await create();
      const staffId = created.owners[0]?.staffId ?? '';
      await admin.staff.update({ where: { id: staffId }, data: { totpSecret: 'v1.x.y.z' } });

      await platform.post(`/organizations/${created.id}/staff/${staffId}/reset-totp`).expect(204);

      const detail = (await platform.get(`/organizations/${created.id}`).expect(200))
        .body as PlatformOrganizationDetailDto;
      expect(detail.owners[0]?.totpEnabled).toBe(false);
      await expect(
        admin.auditLog.findFirst({
          where: { organizationId: created.id, action: 'platform.staff.totp_reset' },
        }),
      ).resolves.toMatchObject({ actorId: operator.id });
    });

    it('answers 404 when the staff member belongs to another organization', async () => {
      const one = await create();
      const other = await create();
      const foreignStaff = other.owners[0]?.staffId ?? '';

      await platform
        .post(`/organizations/${one.id}/staff/${foreignStaff}/reset-password`, {
          temporaryPassword: 'reset-by-support-1',
        })
        .expect(404);
    });
  });
});
