import request from 'supertest';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import { cookiesFrom, createTestApp, hostOf, type TestApp } from './support/app';
import { createAdminClient, createOrganization, memberPhone, uniquePhone } from './support/db';

const MEMBER_CLIENT = { 'x-gatefit-client': 'member' };

describe('Member sign-in by SMS code (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;

  const http = () => request(t.app.getHttpServer());
  const requestCode = (organization: Organization, phone: string) =>
    http().post('/api/v1/auth/otp/request').set('Host', hostOf(organization)).send({ phone });
  const verify = (organization: Organization, phone: string, code: string) =>
    http().post('/api/v1/auth/otp/verify').set('Host', hostOf(organization)).send({ phone, code });
  const wrongCodeFor = (code: string) => (code === '000000' ? '000001' : '000000');

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');
    await admin.organization.update({ where: { id: orgB.id }, data: { locale: 'ru' } });
  });

  afterEach(() => {
    t.clock.reset();
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  it('sends a six-digit code in the language of the organization', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);
    await requestCode(orgB, phone).expect(204);

    const [uzbek, russian] = t.sms.sent.filter((sms) => sms.to === phone);
    expect(uzbek?.text).toMatch(/^Gatefit: kirish kodi \d{6}\./);
    expect(russian?.text).toMatch(/^Gatefit: код для входа \d{6}\./);
  });

  it('stores only a keyed hash of the code', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);

    const stored = await admin.otpCode.findFirstOrThrow({ where: { phone } });
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.codeHash).not.toContain(t.sms.lastCode(phone));
  });

  it('signs the member in with the right code and sets member cookies', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);

    const response = await verify(orgA, phone, t.sms.lastCode(phone)).expect(204);
    const cookies = cookiesFrom(response);
    expect(cookies.map((cookie) => cookie.split('=')[0])).toEqual([
      'gf_member_access',
      'gf_member_refresh',
    ]);

    const me = await http()
      .get('/api/v1/me')
      .set('Host', hostOf(orgA))
      .set(MEMBER_CLIENT)
      .set('Cookie', cookies)
      .expect(200);
    expect(me.body).toMatchObject({
      audience: 'member',
      user: { phone },
      organization: { id: orgA.id },
      staff: null,
    });
  });

  it('keeps one identity per phone across sign-ins', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    for (let round = 0; round < 2; round += 1) {
      await requestCode(orgA, phone).expect(204);
      await verify(orgA, phone, t.sms.lastCode(phone)).expect(204);
    }
    await expect(admin.user.count({ where: { phone } })).resolves.toBe(1);
  });

  it('rejects a wrong code', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);

    const response = await verify(orgA, phone, wrongCodeFor(t.sms.lastCode(phone))).expect(401);
    expect(response.body).toMatchObject({ code: 'INVALID_OTP' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('locks the code after five wrong guesses, even for the right one', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);
    const code = t.sms.lastCode(phone);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await verify(orgA, phone, wrongCodeFor(code)).expect(401);
    }
    const response = await verify(orgA, phone, code).expect(401);
    expect(response.body).toMatchObject({ code: 'OTP_ATTEMPTS_EXCEEDED' });
  });

  it('expires the code after five minutes', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);

    t.clock.advance(5 * 60 + 1);
    const response = await verify(orgA, phone, t.sms.lastCode(phone)).expect(401);
    expect(response.body).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('accepts a code only once', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);
    const code = t.sms.lastCode(phone);

    await verify(orgA, phone, code).expect(204);
    const again = await verify(orgA, phone, code).expect(401);
    expect(again.body).toMatchObject({ code: 'INVALID_OTP' });
  });

  it('invalidates the previous code when a new one is requested', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);
    const first = t.sms.lastCode(phone);
    await requestCode(orgA, phone).expect(204);
    const second = t.sms.lastCode(phone);

    if (first !== second) {
      await verify(orgA, phone, first).expect(401);
    }
    await verify(orgA, phone, second).expect(204);
  });

  it("does not accept one organization's code at another organization", async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    await requestCode(orgA, phone).expect(204);

    const response = await verify(orgB, phone, t.sms.lastCode(phone)).expect(401);
    expect(response.body).toMatchObject({ code: 'INVALID_OTP' });
  });

  it('limits how many codes one phone can request', async () => {
    const phone = await memberPhone(admin, orgA, orgB);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await requestCode(orgA, phone).expect(204);
    }
    const response = await requestCode(orgA, phone).expect(429);
    expect(response.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(t.sms.sent.filter((sms) => sms.to === phone)).toHaveLength(3);
  });

  it('sends nothing to a phone that is not a member, and says the same', async () => {
    const stranger = uniquePhone();
    await requestCode(orgA, stranger).expect(204);
    expect(t.sms.sent.filter((sms) => sms.to === stranger)).toEqual([]);
    await verify(orgA, stranger, '123456').expect(401);
  });

  it('only lets a member sign in where they are a member', async () => {
    const phone = await memberPhone(admin, orgA);
    await requestCode(orgB, phone).expect(204);
    expect(t.sms.sent.filter((sms) => sms.to === phone)).toEqual([]);
  });

  it('links the member to their identity at first sign-in', async () => {
    const phone = await memberPhone(admin, orgA);
    await requestCode(orgA, phone).expect(204);
    await verify(orgA, phone, t.sms.lastCode(phone)).expect(204);

    const user = await admin.user.findUniqueOrThrow({ where: { phone } });
    const member = await admin.member.findFirstOrThrow({
      where: { organizationId: orgA.id, phone },
    });
    expect(member.userId).toBe(user.id);
  });

  it('refuses an archived member, even with a code sent before archiving', async () => {
    const phone = await memberPhone(admin, orgA);
    await requestCode(orgA, phone).expect(204);
    const code = t.sms.lastCode(phone);
    await admin.member.updateMany({
      where: { organizationId: orgA.id, phone },
      data: { deletedAt: new Date() },
    });

    const response = await verify(orgA, phone, code).expect(401);
    expect(response.body).toMatchObject({ code: 'INVALID_OTP' });
    const sent = t.sms.sent.filter((sms) => sms.to === phone).length;
    await requestCode(orgA, phone).expect(204);
    expect(t.sms.sent.filter((sms) => sms.to === phone)).toHaveLength(sent);
  });

  it('rejects a malformed phone or code', async () => {
    await requestCode(orgA, 'not-a-phone').expect(400);
    await verify(orgA, uniquePhone(), '12ab').expect(400);
  });
});
