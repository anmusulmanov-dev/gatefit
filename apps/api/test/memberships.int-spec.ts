import type {
  MemberDto,
  MemberListItemDto,
  MembershipDto,
  Page,
  PlanDto,
  SaleDto,
} from '@gatefit/shared';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import { MembershipStatusJob } from '../src/modules/plans/membership-status.job';
import { MembershipsService } from '../src/modules/plans/memberships.service';
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

// Fixed dates lie in the future of the real clock, so the hourly job, which runs over all
// organizations in the shared test database, never treats them as due.
const MARCH_1_TASHKENT_NOON = '2027-03-01T07:00:00Z';

describe('Plans and memberships (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let two: Location;
  let newYork: Location;
  let ownerUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  let manager: ReturnType<typeof apiAs>;
  /** Works at location One only. */
  let receptionist: ReturnType<typeof apiAs>;
  let trainer: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;
  let users: {
    staff: StaffFixture;
    organization: Organization;
    set: (api: ReturnType<typeof apiAs>) => void;
  }[];
  let moved = false;

  /** Sessions are tied to the clock: sign everyone in again at the current test time. */
  const signIn = async () => {
    for (const user of users) {
      user.set(apiAs(t, user.organization, await cookiesFor(t, user.organization, user.staff)));
    }
  };
  /** Moves the test clock (dates of sales and freezes follow it) and signs in again. */
  const travel = async (instant: Date | string) => {
    t.clock.set(instant);
    moved = true;
    await signIn();
  };

  const monthly = (overrides: Record<string, unknown> = {}): object => ({
    name: 'Monthly',
    type: 'duration',
    durationValue: 1,
    durationUnit: 'month',
    priceMinor: '45000000',
    freeze: { maxDays: 30, maxTimes: 2, minDays: 3, feeMinor: '1000000' },
    ...overrides,
  });
  const createPlanVia = async (body: object = monthly(), as = owner): Promise<PlanDto> =>
    (await as.post('/plans', body).expect(201)).body as PlanDto;
  const createMember = async (location = one, as = owner): Promise<MemberDto> =>
    (
      await as
        .post('/members', {
          firstName: 'Aziz',
          lastName: 'Karimov',
          phone: uniquePhone(),
          homeLocationId: location.id,
        })
        .expect(201)
    ).body as MemberDto;
  // Payment is far off, so a sale alone does not make the member a debtor; the billing
  // tests cover debts.
  const sell = async (memberId: string, body: object, as = owner): Promise<MembershipDto> =>
    (
      (
        await as
          .post(`/members/${memberId}/memberships`, { dueOn: '2099-12-31', ...body })
          .expect(201)
      ).body as SaleDto
    ).membership;
  const memberStatus = async (memberId: string) =>
    ((await owner.get(`/members/${memberId}`).expect(200)).body as MemberDto).status;
  const membership = async (id: string) =>
    (await owner.get(`/memberships/${id}`).expect(200)).body as MembershipDto;
  const applyDue = (organization: Organization, now: string) =>
    t.app
      .get(TenantDb)
      .run(organization.id, (tx) =>
        t.app.get(MembershipsService).applyDueChanges(tx, organization.id, new Date(now)),
      );
  const auditOf = (action: string, entityId: string) =>
    admin.auditLog.findMany({ where: { organizationId: orgA.id, action, entityId } });

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    const saasPlan = await createPlan(admin, 'start');
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');
    for (const organization of [orgA, orgB]) {
      await admin.organization.update({
        where: { id: organization.id },
        data: { saasPlanId: saasPlan.id },
      });
    }
    const location = (name: string, timezone = 'Asia/Tashkent') =>
      admin.location.create({ data: { organizationId: orgA.id, name, timezone } });
    one = await location('One');
    two = await location('Two');
    newYork = await location('New York', 'America/New_York');

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

    const ownerBUser = await createStaff(admin, orgB, 'owner');
    users = [
      { staff: ownerUser, organization: orgA, set: (api) => (owner = api) },
      { staff: managerUser, organization: orgA, set: (api) => (manager = api) },
      { staff: receptionistUser, organization: orgA, set: (api) => (receptionist = api) },
      { staff: trainerUser, organization: orgA, set: (api) => (trainer = api) },
      { staff: ownerBUser, organization: orgB, set: (api) => (ownerB = api) },
    ];
    await signIn();
  });

  afterEach(async () => {
    if (moved) {
      t.clock.reset();
      moved = false;
      await signIn();
    }
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('plans', () => {
    it("adds a plan in the organization's currency and audits it", async () => {
      const plan = await createPlanVia(monthly({ description: '  Gym  ' }));
      expect(plan).toEqual({
        id: expect.any(String) as string,
        name: 'Monthly',
        description: 'Gym',
        type: 'duration',
        durationValue: 1,
        durationUnit: 'month',
        visitLimit: null,
        priceMinor: '45000000',
        currency: 'UZS',
        restrictions: { timeWindows: [], weekdays: [], dailyVisitLimit: null, locationIds: [] },
        freeze: { maxDays: 30, maxTimes: 2, minDays: 3, feeMinor: '1000000' },
        isActive: true,
        createdAt: expect.any(String) as string,
      });
      const [entry] = await auditOf('plan.create', plan.id);
      expect(entry).toMatchObject({
        actorId: ownerUser.userId,
        after: { priceMinor: '45000000', currency: 'UZS' },
      });
    });

    it('checks the shape of each plan type', async () => {
      await owner.post('/plans', monthly({ type: 'visits' })).expect(400);
      await owner.post('/plans', monthly({ type: 'duration', visitLimit: 12 })).expect(400);
      await owner.post('/plans', monthly({ priceMinor: '-1' })).expect(400);
      await owner.post('/plans', monthly({ priceMinor: '450.00' })).expect(400);
      const single = await createPlanVia(
        monthly({ name: 'Day pass', type: 'single', durationValue: 1, durationUnit: 'day' }),
      );
      expect(single.visitLimit).toBe(1);
      const visits = await createPlanVia(monthly({ type: 'visits', visitLimit: 12 }));
      expect(visits.visitLimit).toBe(12);
    });

    it('stores restrictions and refuses unknown locations in them', async () => {
      const plan = await createPlanVia(
        monthly({
          restrictions: {
            timeWindows: [{ from: '07:00', to: '12:00' }],
            weekdays: [5, 1, 3, 1],
            dailyVisitLimit: 1,
            locationIds: [one.id],
          },
        }),
      );
      expect(plan.restrictions).toEqual({
        timeWindows: [{ from: '07:00', to: '12:00' }],
        weekdays: [1, 3, 5],
        dailyVisitLimit: 1,
        locationIds: [one.id],
      });
      await owner
        .post(
          '/plans',
          monthly({ restrictions: { timeWindows: [{ from: '12:00', to: '07:00' }] } }),
        )
        .expect(400);
      const response = await owner
        .post('/plans', monthly({ restrictions: { locationIds: [orgB.id] } }))
        .expect(422);
      expect(response.body).toMatchObject({ code: 'INVALID_REFERENCE' });
    });

    it('edits a plan without changing memberships already sold', async () => {
      const plan = await createPlanVia();
      const member = await createMember();
      const sold = await sell(member.id, { planId: plan.id });

      const response = await owner
        .patch(`/plans/${plan.id}`, { priceMinor: '50000000', name: 'Monthly+' })
        .expect(200);
      expect(response.body).toMatchObject({ priceMinor: '50000000', name: 'Monthly+' });
      await expect(membership(sold.id)).resolves.toMatchObject({
        priceMinor: '45000000',
        plan: { name: 'Monthly' },
      });
      const [entry] = await auditOf('plan.update', plan.id);
      expect(entry).toMatchObject({
        before: { priceMinor: '45000000' },
        after: { fields: ['name', 'priceMinor'], priceMinor: '50000000' },
      });
      await owner.patch(`/plans/${plan.id}`, { type: 'visits' }).expect(422);
    });

    it('withdraws a plan from sale', async () => {
      const plan = await createPlanVia();
      await owner.patch(`/plans/${plan.id}`, { isActive: false }).expect(200);
      const active = (await owner.get('/plans?active=true&limit=100').expect(200))
        .body as Page<PlanDto>;
      expect(active.items.map((item) => item.id)).not.toContain(plan.id);
      const inactive = (await owner.get('/plans?active=false&limit=100').expect(200))
        .body as Page<PlanDto>;
      expect(inactive.items.map((item) => item.id)).toContain(plan.id);

      const member = await createMember();
      const refused = await owner
        .post(`/members/${member.id}/memberships`, { planId: plan.id })
        .expect(422);
      expect(refused.body).toMatchObject({ code: 'PLAN_INACTIVE' });
    });

    it('lets staff read plans and only managers of plans change them', async () => {
      const plan = await createPlanVia();
      await receptionist.get(`/plans/${plan.id}`).expect(200);
      await trainer.get('/plans').expect(403);
      await receptionist.post('/plans', monthly()).expect(403);
      await manager.patch(`/plans/${plan.id}`, { name: 'X' }).expect(403);
    });

    it('needs the memberships module', async () => {
      const bare = await createOrganization(admin, 'Bare');
      const bareOwner = apiAs(
        t,
        bare,
        await cookiesFor(t, bare, await createStaff(admin, bare, 'owner')),
      );
      const response = await bareOwner.get('/plans').expect(403);
      expect(response.body).toMatchObject({ code: 'MODULE_NOT_AVAILABLE' });
    });
  });

  describe('selling', () => {
    it('sells a plan from today in the location time zone and makes the member active', async () => {
      // 20:00 UTC on 28 Feb is already 1 March in Tashkent.
      await travel('2027-02-28T20:00:00Z');
      const plan = await createPlanVia();
      const member = await createMember();
      expect(member.status).toBe('inactive');

      const sold = await sell(member.id, { planId: plan.id });
      expect(sold).toMatchObject({
        memberId: member.id,
        plan: { id: plan.id, name: 'Monthly', type: 'duration' },
        location: { id: one.id, name: 'One', timezone: 'Asia/Tashkent' },
        status: 'active',
        startsOn: '2027-03-01',
        endsOn: '2027-03-31',
        endsAt: '2027-03-31T19:00:00.000Z',
        daysLeft: 31,
        visitLimit: null,
        visitsLeft: null,
        priceMinor: '45000000',
        currency: 'UZS',
        freeze: { maxDays: 30, maxTimes: 2, minDays: 3, daysUsed: 0, timesUsed: 0 },
        freezes: [],
        cancelledAt: null,
      });
      await expect(memberStatus(member.id)).resolves.toBe('active');
      const [entry] = await auditOf('membership.sell', sold.id);
      expect(entry).toMatchObject({
        actorId: ownerUser.userId,
        after: { memberId: member.id, priceMinor: '45000000', endsOn: '2027-03-31' },
      });
    });

    it('sells for a later start; the member is not active until then', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const member = await createMember();
      const sold = await sell(member.id, {
        planId: (await createPlanVia()).id,
        startsOn: '2027-03-15',
      });
      expect(sold).toMatchObject({ status: 'scheduled', endsOn: '2027-04-14', daysLeft: null });
      await expect(memberStatus(member.id)).resolves.toBe('inactive');
    });

    it('refuses start dates too far back or ahead', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const plan = await createPlanVia();
      const member = await createMember();
      const ahead = await owner
        .post(`/members/${member.id}/memberships`, { planId: plan.id, startsOn: '2027-06-01' })
        .expect(422);
      expect(ahead.body).toMatchObject({ code: 'INVALID_START_DATE' });
      // A month-long membership that started two months ago has already ended.
      await owner
        .post(`/members/${member.id}/memberships`, { planId: plan.id, startsOn: '2027-01-01' })
        .expect(422);
      // Entered late from paper: started a week ago, still running.
      await sell(member.id, { planId: plan.id, startsOn: '2027-02-22' });
    });

    it('allows one trial per member', async () => {
      const trial = await createPlanVia(
        monthly({
          name: 'Trial',
          type: 'trial',
          durationValue: 3,
          durationUnit: 'day',
          priceMinor: '0',
        }),
      );
      const member = await createMember();
      await sell(member.id, { planId: trial.id });
      const again = await owner
        .post(`/members/${member.id}/memberships`, { planId: trial.id })
        .expect(409);
      expect(again.body).toMatchObject({ code: 'TRIAL_ALREADY_USED' });
    });

    it('sells only where the plan is valid and the seller works', async () => {
      const onlyTwo = await createPlanVia(monthly({ restrictions: { locationIds: [two.id] } }));
      const member = await createMember(one);
      const refused = await owner
        .post(`/members/${member.id}/memberships`, { planId: onlyTwo.id })
        .expect(422);
      expect(refused.body).toMatchObject({ code: 'PLAN_NOT_AT_LOCATION' });
      const atTwo = await sell(member.id, { planId: onlyTwo.id, locationId: two.id });
      expect(atTwo.location.id).toBe(two.id);

      const plan = await createPlanVia();
      const notHere = await receptionist
        .post(`/members/${member.id}/memberships`, { planId: plan.id, locationId: two.id })
        .expect(403);
      expect(notHere.body).toMatchObject({ code: 'LOCATION_NOT_ASSIGNED' });
      await sell(member.id, { planId: plan.id }, receptionist);

      const elsewhere = await createMember(two);
      await receptionist
        .post(`/members/${elsewhere.id}/memberships`, { planId: plan.id })
        .expect(404);
      await receptionist.get(`/members/${elsewhere.id}/memberships`).expect(404);
      await trainer.post(`/members/${member.id}/memberships`, { planId: plan.id }).expect(403);
    });

    it('counts visits for visit plans', async () => {
      const plan = await createPlanVia(monthly({ type: 'visits', visitLimit: 12 }));
      const sold = await sell((await createMember()).id, { planId: plan.id });
      expect(sold).toMatchObject({ visitLimit: 12, visitsLeft: 12 });
    });

    it('lists the member’s memberships and shows the one in force in the member list', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const plan = await createPlanVia();
      const member = await createMember();
      const later = await sell(member.id, { planId: plan.id, startsOn: '2027-04-01' });
      const now = await sell(member.id, { planId: plan.id });

      const page = (await trainer.get(`/members/${member.id}/memberships`).expect(200))
        .body as Page<MembershipDto>;
      expect(page.items.map((item) => item.id)).toEqual([now.id, later.id]);

      const list = (await owner.get(`/members?limit=100&q=${member.phone.slice(4)}`).expect(200))
        .body as Page<MemberListItemDto>;
      expect(list.items[0]?.membership).toEqual({
        id: now.id,
        planName: 'Monthly',
        status: 'active',
        endsOn: '2027-03-31',
        daysLeft: 31,
        visitsLeft: null,
      });
    });
  });

  describe('expiry at midnight (acceptance criterion 6)', () => {
    it('expires at midnight in the location time zone and updates the member', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const plan = await createPlanVia();
      const member = await createMember();
      const sold = await sell(member.id, { planId: plan.id });
      expect(sold.endsAt).toBe('2027-03-31T19:00:00.000Z');

      await applyDue(orgA, '2027-03-31T18:59:59.999Z');
      await expect(membership(sold.id)).resolves.toMatchObject({ status: 'active' });
      await expect(memberStatus(member.id)).resolves.toBe('active');

      await applyDue(orgA, '2027-03-31T19:00:00.000Z');
      await expect(membership(sold.id)).resolves.toMatchObject({
        status: 'expired',
        daysLeft: null,
      });
      await expect(memberStatus(member.id)).resolves.toBe('expired');
      const entries = await auditOf('membership.status', sold.id);
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: null,
          before: { status: 'active' },
          after: { status: 'expired' },
        }),
      ]);

      // Again: nothing changes, nothing is written twice.
      await applyDue(orgA, '2027-03-31T20:00:00.000Z');
      await expect(auditOf('membership.status', sold.id)).resolves.toHaveLength(1);
    });

    it('follows each location’s own midnight', async () => {
      await travel('2027-03-01T17:00:00Z'); // noon in New York, 22:00 in Tashkent
      const plan = await createPlanVia();
      const member = await createMember();
      const ny = await sell(member.id, { planId: plan.id, locationId: newYork.id });
      expect(ny).toMatchObject({ endsOn: '2027-03-31', endsAt: '2027-04-01T04:00:00.000Z' });

      await applyDue(orgA, '2027-03-31T19:00:00.000Z');
      await expect(membership(ny.id)).resolves.toMatchObject({ status: 'active' });
      await applyDue(orgA, '2027-04-01T04:00:00.000Z');
      await expect(membership(ny.id)).resolves.toMatchObject({ status: 'expired' });
    });

    it('starts a scheduled membership on its day', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const member = await createMember();
      const sold = await sell(member.id, {
        planId: (await createPlanVia()).id,
        startsOn: '2027-03-10',
      });
      await applyDue(orgA, '2027-03-09T19:00:00.000Z');
      await expect(membership(sold.id)).resolves.toMatchObject({ status: 'active' });
      await expect(memberStatus(member.id)).resolves.toBe('active');
    });

    it('is run by the hourly job over every organization with work', async () => {
      // Sold two months ago in test time, so it is due by the real clock.
      await travel(new Date(Date.now() - 62 * 86_400_000));
      const member = await createMember();
      const sold = await sell(member.id, { planId: (await createPlanVia()).id });
      await travel(new Date());

      await expect(t.app.get(MembershipStatusJob).run()).resolves.toBeGreaterThanOrEqual(1);
      await expect(membership(sold.id)).resolves.toMatchObject({ status: 'expired' });
      await expect(memberStatus(member.id)).resolves.toBe('expired');
    });
  });

  describe('freezing (acceptance criterion 7)', () => {
    let plan: PlanDto;

    beforeAll(async () => {
      plan = await createPlanVia();
    });

    // The monthly plan's freeze fee is paid on the spot, so freezing creates no debt.
    const freeze = (id: string, body: object, as = owner) =>
      as.post(`/memberships/${id}/freeze`, {
        payment: { method: 'card_terminal', amountMinor: '1000000' },
        ...body,
      });

    it('moves the end later by the frozen days and freezes the member on those days', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const member = await createMember();
      const sold = await sell(member.id, { planId: plan.id });

      const frozen = (
        await freeze(sold.id, { startsOn: '2027-03-10', days: 10, reason: 'Travel' }).expect(200)
      ).body as MembershipDto;
      expect(frozen).toMatchObject({
        status: 'active',
        endsOn: '2027-04-10',
        endsAt: '2027-04-10T19:00:00.000Z',
        freeze: { daysUsed: 10, timesUsed: 1 },
        freezes: [
          {
            startsOn: '2027-03-10',
            endsOn: '2027-03-19',
            days: 10,
            reason: 'Travel',
            source: 'staff',
            feeMinor: '1000000',
            currency: 'UZS',
            endedEarly: false,
          },
        ],
      });
      const [entry] = await auditOf('membership.freeze', sold.id);
      expect(entry).toMatchObject({
        before: { endsOn: '2027-03-31' },
        after: { endsOn: '2027-04-10', days: 10 },
      });

      await applyDue(orgA, '2027-03-09T19:00:00.000Z');
      await expect(membership(sold.id)).resolves.toMatchObject({ status: 'frozen' });
      await expect(memberStatus(member.id)).resolves.toBe('frozen');

      await applyDue(orgA, '2027-03-19T19:00:00.000Z');
      await expect(membership(sold.id)).resolves.toMatchObject({ status: 'active' });
      await expect(memberStatus(member.id)).resolves.toBe('active');

      // The new end holds: active on 10 April, expired from 11 April in Tashkent.
      await applyDue(orgA, '2027-04-10T18:59:59.000Z');
      await expect(membership(sold.id)).resolves.toMatchObject({ status: 'active' });
      await applyDue(orgA, '2027-04-10T19:00:00.000Z');
      await expect(membership(sold.id)).resolves.toMatchObject({ status: 'expired' });
    });

    it('freezes from today at once', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const member = await createMember();
      const sold = await sell(member.id, { planId: plan.id });
      const frozen = (
        await freeze(sold.id, {
          startsOn: '2027-03-01',
          days: 5,
          reason: 'Ill',
          source: 'member_request',
        }).expect(200)
      ).body as MembershipDto;
      expect(frozen).toMatchObject({ status: 'frozen', endsOn: '2027-04-05', daysLeft: 36 });
      expect(frozen.freezes[0]?.source).toBe('member_request');
      await expect(memberStatus(member.id)).resolves.toBe('frozen');
    });

    it('ends a freeze early and gives back the unused days', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const member = await createMember();
      const sold = await sell(member.id, { planId: plan.id });
      await freeze(sold.id, { startsOn: '2027-03-01', days: 10, reason: 'Travel' }).expect(200);

      await travel('2027-03-04T07:00:00Z');
      const thawed = (await owner.post(`/memberships/${sold.id}/unfreeze`).expect(200))
        .body as MembershipDto;
      expect(thawed).toMatchObject({
        status: 'active',
        endsOn: '2027-04-03',
        freeze: { daysUsed: 3, timesUsed: 1 },
        freezes: [{ startsOn: '2027-03-01', endsOn: '2027-03-03', days: 3, endedEarly: true }],
      });
      await expect(memberStatus(member.id)).resolves.toBe('active');
      await expect(auditOf('membership.unfreeze', sold.id)).resolves.toEqual([
        expect.objectContaining({ after: expect.objectContaining({ daysReturned: 7 }) as object }),
      ]);
      const none = await owner.post(`/memberships/${sold.id}/unfreeze`).expect(409);
      expect(none.body).toMatchObject({ code: 'NO_FREEZE_TO_END' });
    });

    it('drops a planned freeze entirely', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const sold = await sell((await createMember()).id, { planId: plan.id });
      await freeze(sold.id, { startsOn: '2027-03-20', days: 5, reason: 'Trip' }).expect(200);
      const back = (await owner.post(`/memberships/${sold.id}/unfreeze`).expect(200))
        .body as MembershipDto;
      expect(back).toMatchObject({
        endsOn: '2027-03-31',
        freezes: [],
        freeze: { daysUsed: 0, timesUsed: 0 },
      });
    });

    it('refuses overlapping freezes and freezes beyond the limits', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const sold = await sell((await createMember()).id, { planId: plan.id });
      await freeze(sold.id, { startsOn: '2027-03-10', days: 10, reason: 'A' }).expect(200);

      const overlap = await freeze(sold.id, {
        startsOn: '2027-03-15',
        days: 5,
        reason: 'B',
      }).expect(409);
      expect(overlap.body).toMatchObject({
        code: 'FREEZE_OVERLAP',
        details: { startsOn: '2027-03-10', endsOn: '2027-03-19' },
      });
      const tooShort = await freeze(sold.id, {
        startsOn: '2027-03-25',
        days: 2,
        reason: 'C',
      }).expect(422);
      expect(tooShort.body).toMatchObject({
        code: 'FREEZE_LIMIT_EXCEEDED',
        details: { minDays: 3, maxDays: 30, daysUsed: 10, timesUsed: 1 },
      });
      const tooLong = await freeze(sold.id, {
        startsOn: '2027-03-25',
        days: 21,
        reason: 'C',
      }).expect(422);
      expect(tooLong.body).toMatchObject({ code: 'FREEZE_LIMIT_EXCEEDED' });
      await freeze(sold.id, { startsOn: '2027-03-25', days: 20, reason: 'C' }).expect(200);
      const third = await freeze(sold.id, { startsOn: '2027-04-20', days: 3, reason: 'D' }).expect(
        422,
      );
      expect(third.body).toMatchObject({ code: 'FREEZE_LIMIT_EXCEEDED' });

      const past = await freeze(sold.id, { startsOn: '2027-02-28', days: 3, reason: 'E' }).expect(
        422,
      );
      expect(past.body).toMatchObject({ code: 'INVALID_FREEZE_DATES' });
    });

    it('refuses freezing a plan that does not allow it', async () => {
      const noFreeze = await createPlanVia(monthly({ freeze: undefined }));
      const sold = await sell((await createMember()).id, { planId: noFreeze.id });
      const response = await freeze(sold.id, {
        startsOn: sold.startsOn,
        days: 3,
        reason: 'X',
      }).expect(422);
      expect(response.body).toMatchObject({ code: 'FREEZE_NOT_ALLOWED' });
    });

    it('needs memberships.freeze', async () => {
      const sold = await sell((await createMember()).id, { planId: plan.id });
      await freeze(sold.id, { startsOn: sold.startsOn, days: 3, reason: 'X' }, trainer).expect(403);
      await freeze(sold.id, { startsOn: sold.startsOn, days: 3, reason: 'X' }, receptionist).expect(
        200,
      );
    });
  });

  describe('cancelling', () => {
    it('cancels with a reason and recomputes the member status', async () => {
      const plan = await createPlanVia();
      const member = await createMember();
      const sold = await sell(member.id, { planId: plan.id });

      await owner.post(`/memberships/${sold.id}/cancel`, {}).expect(400);
      const cancelled = (
        await owner.post(`/memberships/${sold.id}/cancel`, { reason: 'Moved away' }).expect(200)
      ).body as MembershipDto;
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Moved away',
        daysLeft: null,
      });
      expect(cancelled.cancelledAt).not.toBeNull();
      await expect(memberStatus(member.id)).resolves.toBe('inactive');
      await expect(auditOf('membership.cancel', sold.id)).resolves.toHaveLength(1);

      const again = await owner.post(`/memberships/${sold.id}/cancel`, { reason: 'X' }).expect(409);
      expect(again.body).toMatchObject({ code: 'MEMBERSHIP_NOT_IN_FORCE' });
      const freeze = await owner
        .post(`/memberships/${sold.id}/freeze`, { startsOn: sold.startsOn, days: 3, reason: 'X' })
        .expect(409);
      expect(freeze.body).toMatchObject({ code: 'MEMBERSHIP_NOT_IN_FORCE' });
    });

    it('needs memberships.cancel', async () => {
      const sold = await sell((await createMember()).id, { planId: (await createPlanVia()).id });
      await receptionist.post(`/memberships/${sold.id}/cancel`, { reason: 'X' }).expect(403);
      await manager.post(`/memberships/${sold.id}/cancel`, { reason: 'X' }).expect(200);
    });
  });

  describe('member status', () => {
    it('returns to what the memberships say after a block is lifted', async () => {
      const member = await createMember();
      await sell(member.id, { planId: (await createPlanVia()).id });
      await owner.post(`/members/${member.id}/block`, { reason: 'Rude' }).expect(200);
      await expect(memberStatus(member.id)).resolves.toBe('blocked');

      // A sale or a job run does not lift a block.
      await sell(member.id, { planId: (await createPlanVia()).id });
      await expect(memberStatus(member.id)).resolves.toBe('blocked');

      await owner.post(`/members/${member.id}/unblock`).expect(200);
      await expect(memberStatus(member.id)).resolves.toBe('active');
    });

    it('cannot change memberships of an archived member', async () => {
      const member = await createMember();
      const sold = await sell(member.id, { planId: (await createPlanVia()).id });
      await owner.post(`/members/${member.id}/archive`).expect(200);
      const response = await owner
        .post(`/memberships/${sold.id}/cancel`, { reason: 'X' })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'MEMBER_ARCHIVED' });
      await owner.get(`/memberships/${sold.id}`).expect(200);
    });
  });

  describe('organization isolation (acceptance criterion 10)', () => {
    it('B sees none of A’s plans, memberships or freezes', async () => {
      await travel(MARCH_1_TASHKENT_NOON);
      const plan = await createPlanVia();
      const member = await createMember();
      const sold = await sell(member.id, { planId: plan.id });
      await owner
        .post(`/memberships/${sold.id}/freeze`, { startsOn: '2027-03-10', days: 3, reason: 'X' })
        .expect(200);

      await ownerB.get(`/plans/${plan.id}`).expect(404);
      const plansB = (await ownerB.get('/plans?limit=100').expect(200)).body as Page<PlanDto>;
      expect(plansB.items).toEqual([]);
      await ownerB.patch(`/plans/${plan.id}`, { name: 'Mine' }).expect(404);
      await ownerB.get(`/memberships/${sold.id}`).expect(404);
      await ownerB.post(`/memberships/${sold.id}/cancel`, { reason: 'X' }).expect(404);
      await ownerB.post(`/memberships/${sold.id}/unfreeze`).expect(404);
      await ownerB.get(`/members/${member.id}/memberships`).expect(404);

      // B's member cannot be sold A's plan.
      const memberB = (
        await ownerB
          .post('/members', {
            firstName: 'B',
            lastName: 'Member',
            phone: uniquePhone(),
            homeLocationId: (
              await admin.location.create({
                data: { organizationId: orgB.id, name: 'B1', timezone: 'Asia/Tashkent' },
              })
            ).id,
          })
          .expect(201)
      ).body as MemberDto;
      await ownerB.post(`/members/${memberB.id}/memberships`, { planId: plan.id }).expect(404);

      // Below the API: RLS hides A's rows from a transaction bound to B.
      const seen = await t.app.get(TenantDb).run(orgB.id, async (tx) => ({
        plans: await tx.plan.count({ where: { organizationId: orgA.id } }),
        memberships: await tx.membership.count({ where: { organizationId: orgA.id } }),
        freezes: await tx.membershipFreeze.count({ where: { organizationId: orgA.id } }),
      }));
      expect(seen).toEqual({ plans: 0, memberships: 0, freezes: 0 });

      // And B cannot write a row into A.
      await expect(
        t.app.get(TenantDb).run(orgB.id, (tx) =>
          tx.plan.create({
            data: {
              organizationId: orgA.id,
              name: 'Sneaky',
              type: 'duration',
              durationValue: 1,
              durationUnit: 'month',
              priceMinor: 1n,
              currency: 'UZS',
              restrictions: {},
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
