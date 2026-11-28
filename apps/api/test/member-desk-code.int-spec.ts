import type { MemberDeskCodeDto, MemberDto } from '@gatefit/shared';
import request from 'supertest';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  createPlan,
  createStaff,
  createTestApp,
  hostOf,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

describe('Member sign-in code from the front desk (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let two: Location;
  let owner: ReturnType<typeof apiAs>;
  /** Works at location One only. */
  let receptionist: ReturnType<typeof apiAs>;
  let trainer: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;

  const addMember = async (location: Location = one): Promise<MemberDto> =>
    (
      await owner
        .post('/members', {
          firstName: 'Aziz',
          lastName: 'Karimov',
          phone: uniquePhone(),
          homeLocationId: location.id,
        })
        .expect(201)
    ).body as MemberDto;
  const issue = (memberId: string, as = receptionist) =>
    as.postWithoutKey(`/members/${memberId}/sign-in-code`);
  const verify = (phone: string, code: string) =>
    request(t.app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .set('Host', hostOf(orgA))
      .send({ phone, code });

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    const plan = await createPlan(admin, 'start');
    orgA = await createOrganization(admin, 'DeskA');
    orgB = await createOrganization(admin, 'DeskB');
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

    const ownerUser = await createStaff(admin, orgA, 'owner');
    const receptionistUser = await createStaff(admin, orgA, 'receptionist');
    const trainerUser = await createStaff(admin, orgA, 'trainer');
    await admin.staffLocation.createMany({
      data: [
        { organizationId: orgA.id, staffId: receptionistUser.staffId, locationId: one.id },
        { organizationId: orgA.id, staffId: trainerUser.staffId, locationId: one.id },
      ],
    });
    owner = apiAs(t, orgA, await cookiesFor(t, orgA, ownerUser));
    receptionist = apiAs(t, orgA, await cookiesFor(t, orgA, receptionistUser));
    trainer = apiAs(t, orgA, await cookiesFor(t, orgA, trainerUser));
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));
  });

  afterEach(() => {
    t.clock.reset();
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  it('gives the receptionist a code the member signs in with, sends no SMS, audits it', async () => {
    const member = await addMember();
    const sentBefore = t.sms.sent.length;

    const response = await issue(member.id).expect(200);
    const body = response.body as MemberDeskCodeDto;
    expect(body.code).toMatch(/^\d{6}$/);
    const lifetime = new Date(body.expiresAt).getTime() - t.clock.now().getTime();
    expect(lifetime).toBeGreaterThan(14 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(t.sms.sent.length).toBe(sentBefore);

    await verify(member.phone, body.code).expect(204);
    await expect(
      admin.auditLog.findFirst({
        where: {
          organizationId: orgA.id,
          action: 'member.sign_in_code.issue',
          entityId: member.id,
        },
      }),
    ).resolves.not.toBeNull();
  });

  it('replaces a code sent earlier by SMS', async () => {
    const member = await addMember();
    await request(t.app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('Host', hostOf(orgA))
      .send({ phone: member.phone })
      .expect(204);
    const smsCode = t.sms.lastCode(member.phone);

    const { code } = (await issue(member.id).expect(200)).body as MemberDeskCodeDto;
    if (code !== smsCode) {
      await verify(member.phone, smsCode).expect(401);
    }
    await verify(member.phone, code).expect(204);
  });

  it('lasts fifteen minutes', async () => {
    const member = await addMember();
    const { code } = (await issue(member.id).expect(200)).body as MemberDeskCodeDto;

    t.clock.advance(15 * 60 + 1);
    const response = await verify(member.phone, code).expect(401);
    expect(response.body).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('is refused for an archived member', async () => {
    const member = await addMember();
    await owner.postWithoutKey(`/members/${member.id}/archive`).expect(200);

    const response = await issue(member.id, owner).expect(409);
    expect(response.body).toMatchObject({ code: 'MEMBER_ARCHIVED' });
  });

  it("stays within the caller's branches, permissions and organization", async () => {
    const elsewhere = await addMember(two);
    await issue(elsewhere.id).expect(404);
    await issue(elsewhere.id, owner).expect(200);

    const member = await addMember();
    await issue(member.id, trainer).expect(403);
    await issue(member.id, ownerB).expect(404);
  });
});
