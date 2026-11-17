import type { SaasPlanDto } from '@gatefit/shared';
import { Controller, Get, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Organization, PrismaClient, SaasPlan } from '../src/generated/prisma/client';
import { RequirePermission } from '../src/modules/auth/auth.decorators';
import { RequireModule } from '../src/modules/entitlements/entitlements.service';
import {
  apiAs,
  cookiesFor,
  createPlan,
  createPlatformAdmin,
  createStaff,
  createTestApp,
  platformApi,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization } from './support/db';

// No endpoint belongs to a paid module yet, so the rule is exercised on a stand-in.
@Controller('probe')
class ProbeController {
  @Get('schedule')
  @RequirePermission('organization.read')
  @RequireModule('schedule')
  schedule(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('Platform: plans and modules (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let platform: Awaited<ReturnType<typeof platformApi>>;

  const newPlan = (overrides: object = {}) => ({
    key: `plan_${randomUUID().slice(0, 8)}`,
    name: 'Custom',
    limits: { activeMembersPerLocation: 500 },
    modules: ['members', 'schedule'],
    priceMinor: '45000000',
    currency: 'UZS',
    ...overrides,
  });

  beforeAll(async () => {
    t = await createTestApp([ProbeModule]);
    admin = createAdminClient();
    platform = await platformApi(t, await createPlatformAdmin(admin));
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('POST /platform/saas-plans', () => {
    it('creates a plan; money travels as a string of minor units', async () => {
      const input = newPlan();
      const response = await platform.post('/saas-plans', input).expect(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        key: input.key,
        name: 'Custom',
        limits: { activeMembersPerLocation: 500 },
        modules: ['members', 'schedule'],
        priceMinor: '45000000',
        currency: 'UZS',
        isActive: true,
      });
    });

    it('keeps amounts beyond what a floating-point number can hold exactly', async () => {
      const huge = '900719925474099312';
      const created = (
        await platform.post('/saas-plans', newPlan({ priceMinor: huge })).expect(201)
      ).body as SaasPlanDto;
      expect(created.priceMinor).toBe(huge);
    });

    it('rejects a taken key', async () => {
      const input = newPlan();
      await platform.post('/saas-plans', input).expect(201);
      const response = await platform.post('/saas-plans', input).expect(409);
      expect(response.body).toMatchObject({ code: 'PLAN_KEY_TAKEN' });
    });

    it('rejects an unknown module, a fractional or negative price and a bad limit', async () => {
      await platform.post('/saas-plans', newPlan({ modules: ['teleport'] })).expect(400);
      await platform.post('/saas-plans', newPlan({ priceMinor: '12.50' })).expect(400);
      await platform.post('/saas-plans', newPlan({ priceMinor: '-1' })).expect(400);
      await platform.post('/saas-plans', newPlan({ priceMinor: 45000000 })).expect(400);
      await platform
        .post('/saas-plans', newPlan({ limits: { activeMembersPerLocation: 0 } }))
        .expect(400);
    });
  });

  describe('GET and PATCH /platform/saas-plans', () => {
    it('lists plans, cheapest first', async () => {
      const cheap = (await platform.post('/saas-plans', newPlan({ priceMinor: '1' })).expect(201))
        .body as SaasPlanDto;
      const plans = (await platform.get('/saas-plans').expect(200)).body as SaasPlanDto[];
      expect(plans[0]?.id).toBe(cheap.id);
      const prices = plans.map((plan) => BigInt(plan.priceMinor));
      expect(prices).toEqual([...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    });

    it('changes price, limits, modules and availability', async () => {
      const plan = (await platform.post('/saas-plans', newPlan()).expect(201)).body as SaasPlanDto;
      const response = await platform
        .patch(`/saas-plans/${plan.id}`, {
          priceMinor: '60000000',
          limits: { activeMembersPerLocation: null },
          modules: ['members'],
          isActive: false,
        })
        .expect(200);
      expect(response.body).toMatchObject({
        key: plan.key,
        priceMinor: '60000000',
        limits: { activeMembersPerLocation: null },
        modules: ['members'],
        isActive: false,
      });
    });

    it('answers 404 for an unknown plan and 400 for an empty change', async () => {
      await platform.patch(`/saas-plans/${randomUUID()}`, { name: 'X' }).expect(404);
      const plan = (await platform.post('/saas-plans', newPlan()).expect(201)).body as SaasPlanDto;
      await platform.patch(`/saas-plans/${plan.id}`, {}).expect(400);
    });
  });

  describe('@RequireModule', () => {
    let org: Organization;
    let start: SaasPlan;
    let standard: SaasPlan;
    let manager: ReturnType<typeof apiAs>;

    beforeAll(async () => {
      org = await createOrganization(admin, 'A');
      start = await createPlan(admin, 'start');
      standard = await createPlan(admin, 'standard');
      manager = apiAs(t, org, await cookiesFor(t, org, await createStaff(admin, org, 'manager')));
    });

    it('refuses the feature to an organization with no plan', async () => {
      const response = await manager.get('/probe/schedule').expect(403);
      expect(response.body).toEqual({
        code: 'MODULE_NOT_AVAILABLE',
        message: 'Your plan does not include this feature',
        details: null,
      });
    });

    it('refuses it on a plan without the module and allows it on a plan with it', async () => {
      await platform.patch(`/organizations/${org.id}`, { planId: start.id }).expect(200);
      await manager.get('/probe/schedule').expect(403);

      // The platform upgrades the organization: it works on the very next request.
      await platform.patch(`/organizations/${org.id}`, { planId: standard.id }).expect(200);
      await manager.get('/probe/schedule').expect(200, { ok: true });
    });

    it('follows changes to the plan itself', async () => {
      await platform.patch(`/saas-plans/${standard.id}`, { modules: ['members'] }).expect(200);
      await manager.get('/probe/schedule').expect(403);
    });

    it('still checks the permission first', async () => {
      const outsider = apiAs(t, org, []);
      await outsider.get('/probe/schedule').expect(401);
    });
  });
});
