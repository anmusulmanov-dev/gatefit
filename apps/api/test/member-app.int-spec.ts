import type {
  AccessResultDto,
  MemberDto,
  MemberPaymentsDto,
  MemberProfileDto,
  MembershipDto,
  Page,
  PlanDto,
  QrTokenDto,
} from '@gatefit/shared';
import request from 'supertest';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  cookiesFrom,
  createPlan,
  createStaff,
  createTestApp,
  hostOf,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

const PRICE = '45000000';

describe('Member app endpoints (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let b1: Location;
  let owner: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;
  let plan: PlanDto;

  const createMember = async (as = owner, phone = uniquePhone()): Promise<MemberDto> =>
    (
      await as
        .post('/members', {
          firstName: 'Aziz',
          lastName: 'Karimov',
          phone,
          homeLocationId: as === owner ? one.id : b1.id,
        })
        .expect(201)
    ).body as MemberDto;

  /** Signs the member in to the member app and returns a GET for their /me/* endpoints. */
  const memberApp = async (organization: Organization, phone: string) => {
    const http = () => request(t.app.getHttpServer());
    await http()
      .post('/api/v1/auth/otp/request')
      .set('Host', hostOf(organization))
      .send({ phone })
      .expect(204);
    const signedIn = await http()
      .post('/api/v1/auth/otp/verify')
      .set('Host', hostOf(organization))
      .set('x-gatefit-client', 'member')
      .send({ phone, code: t.sms.lastCode(phone) })
      .expect(204);
    const cookies = cookiesFrom(signedIn);
    return (path: string) =>
      http()
        .get(`/api/v1${path}`)
        .set('Host', hostOf(organization))
        .set('x-gatefit-client', 'member')
        .set('Cookie', cookies);
  };

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
    one = await admin.location.create({
      data: { organizationId: orgA.id, name: 'One', timezone: 'Asia/Tashkent' },
    });
    b1 = await admin.location.create({
      data: { organizationId: orgB.id, name: 'B1', timezone: 'Asia/Tashkent' },
    });
    owner = apiAs(t, orgA, await cookiesFor(t, orgA, await createStaff(admin, orgA, 'owner')));
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));
    plan = (
      await owner
        .post('/plans', {
          name: 'Monthly',
          type: 'duration',
          durationValue: 1,
          durationUnit: 'month',
          priceMinor: PRICE,
        })
        .expect(201)
    ).body as PlanDto;
  });

  afterEach(() => {
    t.clock.reset();
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  it('shows the member their own profile, memberships and payments with what they owe', async () => {
    const member = await createMember();
    const other = await createMember();
    // Card payment of half: the rest is owed.
    await owner
      .post(`/members/${member.id}/memberships`, {
        planId: plan.id,
        payment: { method: 'card_terminal', amountMinor: '20000000' },
      })
      .expect(201);
    await owner
      .post(`/members/${other.id}/memberships`, {
        planId: plan.id,
        payment: { method: 'card_terminal', amountMinor: PRICE },
      })
      .expect(201);

    const get = await memberApp(orgA, member.phone);
    expect((await get('/me/member').expect(200)).body).toMatchObject({
      id: member.id,
      firstName: 'Aziz',
      phone: member.phone,
      homeLocation: { id: one.id, name: 'One' },
      photoUrl: null,
    } satisfies Partial<MemberProfileDto>);

    const memberships = (await get('/me/memberships').expect(200)).body as Page<MembershipDto>;
    expect(memberships.items).toHaveLength(1);
    expect(memberships.items[0]).toMatchObject({ memberId: member.id, status: 'active' });

    const payments = (await get('/me/payments').expect(200)).body as MemberPaymentsDto;
    expect(payments.items).toEqual([
      expect.objectContaining({
        amountMinor: '20000000',
        refundedMinor: '0',
        method: 'card_terminal',
        location: { id: one.id, name: 'One' },
      }),
    ]);
    expect(payments.owed).toEqual([{ amountMinor: '25000000', currency: 'UZS' }]);
  });

  it('is for member sessions only', async () => {
    for (const path of ['/me/member', '/me/memberships', '/me/payments', '/me/qr']) {
      await owner.get(path).expect(403);
    }
  });

  it('keeps the same person apart in two organizations', async () => {
    const phone = uniquePhone();
    const inA = await createMember(owner, phone);
    const inB = await createMember(ownerB, phone);
    await owner
      .post(`/members/${inA.id}/memberships`, {
        planId: plan.id,
        payment: { method: 'card_terminal', amountMinor: PRICE },
      })
      .expect(201);

    const getB = await memberApp(orgB, phone);
    expect(((await getB('/me/member').expect(200)).body as MemberProfileDto).id).toBe(inB.id);
    expect(((await getB('/me/memberships').expect(200)).body as Page<MembershipDto>).items).toEqual(
      [],
    );
    expect((await getB('/me/payments').expect(200)).body).toMatchObject({ items: [], owed: [] });
  });

  it('hands out the next codes, each working only from its own turn', async () => {
    const member = await createMember();
    await owner
      .post(`/members/${member.id}/memberships`, {
        planId: plan.id,
        payment: { method: 'card_terminal', amountMinor: PRICE },
      })
      .expect(201);
    // Ten seconds into a 30-second step.
    const step = Math.floor(Date.now() / 30_000) * 30_000 + 60_000;
    t.clock.set(new Date(step + 10_000));
    const get = await memberApp(orgA, member.phone);
    const qr = (await get('/me/qr').expect(200)).body as QrTokenDto;
    expect(qr.upcoming).toHaveLength(4);
    expect(qr.upcoming.map((code) => code.validFrom)).toEqual(
      [1, 2, 3, 4].map((index) => new Date(step + index * 30_000).toISOString()),
    );

    const verify = async (token: string) => {
      const staff = apiAs(
        t,
        orgA,
        await cookiesFor(t, orgA, await createStaff(admin, orgA, 'owner')),
      );
      return (await staff.post('/access/verify', { token, locationId: one.id }).expect(200))
        .body as AccessResultDto;
    };
    const last = qr.upcoming[3];
    expect((await verify(last?.token ?? '')).allowed).toBe(false);
    t.clock.set(new Date(last?.validFrom ?? 0));
    expect((await verify(last?.token ?? '')).allowed).toBe(true);
  });
});
