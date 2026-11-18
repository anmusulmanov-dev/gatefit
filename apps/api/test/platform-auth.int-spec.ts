import { generateSync } from 'otplib';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  cookiesFor,
  cookiesFrom,
  createPlatformAdmin,
  createStaff,
  createTestApp,
  hostOf,
  PLATFORM_HOST,
  type PlatformAdminFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization } from './support/db';

describe('Platform sign-in (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let org: Organization;
  let operator: PlatformAdminFixture;
  let secret: string;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body: object, host = PLATFORM_HOST) =>
    http().post(`/api/v1/platform${path}`).set('Host', host).send(body);
  const me = (cookies: string[], host = PLATFORM_HOST) =>
    http().get('/api/v1/platform/me').set('Host', host).set('Cookie', cookies);
  const codeNow = () => generateSync({ secret, epoch: t.clock.nowSeconds() });

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    org = await createOrganization(admin, 'A');
    operator = await createPlatformAdmin(admin);
  });

  afterEach(() => {
    t.clock.reset();
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  it('requires an authenticator before the first session', async () => {
    const response = await post('/auth/login', {
      phone: operator.phone,
      password: operator.password,
    }).expect(403);
    expect(response.body).toMatchObject({ code: 'TOTP_SETUP_REQUIRED' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('enrols an authenticator and signs in with a strict, httpOnly session cookie', async () => {
    const refused = await post('/auth/login', {
      phone: operator.phone,
      password: operator.password,
    });
    const { setupToken } = (refused.body as { details: { setupToken: string } }).details;

    const setup = await post('/auth/totp/setup', { setupToken }).expect(200);
    const enrolment = setup.body as { secret: string; enrollToken: string };
    secret = enrolment.secret;

    await post('/auth/totp/confirm', { enrollToken: enrolment.enrollToken, code: '000000' }).expect(
      401,
    );
    const confirmed = await post('/auth/totp/confirm', {
      enrollToken: enrolment.enrollToken,
      code: codeNow(),
    }).expect(204);

    const [cookie] = confirmed.headers['set-cookie'] as unknown as string[];
    expect(cookie).toMatch(/^gf_platform_session=.+; .*HttpOnly; SameSite=Strict/);

    const profile = await me(cookiesFrom(confirmed)).expect(200);
    expect(profile.body).toEqual({ id: operator.id, phone: operator.phone, name: 'Test Operator' });

    const stored = await admin.platformAdmin.findUniqueOrThrow({ where: { id: operator.id } });
    expect(stored.totpSecret).toMatch(/^v1\./);
    expect(stored.totpSecret).not.toContain(secret);
  });

  it('then always requires the code', async () => {
    t.clock.advance(60);
    const credentials = { phone: operator.phone, password: operator.password };

    const missing = await post('/auth/login', credentials).expect(401);
    expect(missing.body).toMatchObject({ code: 'TOTP_REQUIRED' });
    const wrong = await post('/auth/login', { ...credentials, totpCode: '000000' }).expect(401);
    expect(wrong.body).toMatchObject({ code: 'INVALID_TOTP' });

    await post('/auth/login', { ...credentials, totpCode: codeNow() }).expect(204);
  });

  it('answers a wrong password and an unknown phone identically', async () => {
    const wrong = await post('/auth/login', { phone: operator.phone, password: 'nope' }).expect(
      401,
    );
    const unknown = await post('/auth/login', { phone: '+998900000000', password: 'nope' }).expect(
      401,
    );
    expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body).toEqual(wrong.body);
  });

  it('refuses a deactivated operator and ends their sessions', async () => {
    const other = await createPlatformAdmin(admin);
    const token = await admin.platformSession.create({
      data: {
        adminId: other.id,
        tokenHash: 'not-used',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(token).toBeDefined();

    await admin.platformAdmin.update({ where: { id: other.id }, data: { status: 'inactive' } });
    await post('/auth/login', { phone: other.phone, password: other.password }).expect(401);
  });

  it('expires the session after twelve hours', async () => {
    t.clock.advance(120);
    const session = cookiesFrom(
      await post('/auth/login', {
        phone: operator.phone,
        password: operator.password,
        totpCode: codeNow(),
      }).expect(204),
    );
    await me(session).expect(200);

    t.clock.advance(12 * 60 * 60 + 1);
    await me(session).expect(401);
  });

  it('logout ends the session at once', async () => {
    t.clock.advance(180);
    const session = cookiesFrom(
      await post('/auth/login', {
        phone: operator.phone,
        password: operator.password,
        totpCode: codeNow(),
      }).expect(204),
    );

    await http()
      .post('/api/v1/platform/auth/logout')
      .set('Host', PLATFORM_HOST)
      .set('Cookie', session)
      .expect(204);
    await me(session).expect(401);
  });

  describe('separation from organizations', () => {
    it('does not exist at an organization address', async () => {
      const login = await post(
        '/auth/login',
        { phone: operator.phone, password: operator.password },
        hostOf(org),
      );
      expect(login.status).toBe(404);
      await me([], hostOf(org)).expect(404);
      await me([], 'localhost').expect(404);
    });

    it('requires a platform session', async () => {
      const response = await me([]).expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('does not accept a staff session, even an owner one', async () => {
      const owner = await createStaff(admin, org, 'owner');
      const staffCookies = await cookiesFor(t, org, owner);
      await me(staffCookies).expect(401);

      // ...nor a staff token dressed up as a platform cookie.
      const [access = ''] = staffCookies;
      const disguised = access.replace('gf_staff_access', 'gf_platform_session');
      await me([disguised]).expect(401);
    });

    it('a platform session opens nothing in an organization', async () => {
      t.clock.advance(240);
      const session = cookiesFrom(
        await post('/auth/login', {
          phone: operator.phone,
          password: operator.password,
          totpCode: codeNow(),
        }).expect(204),
      );
      await http().get('/api/v1/me').set('Host', hostOf(org)).set('Cookie', session).expect(401);
    });

    it('the API role cannot read platform identities', async () => {
      const prisma = t.app.get(PrismaService);
      await expect(prisma.$queryRaw`SELECT phone FROM platform_admins`).rejects.toThrow(
        /permission denied/,
      );
      await expect(prisma.$queryRaw`SELECT id FROM platform_sessions`).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
