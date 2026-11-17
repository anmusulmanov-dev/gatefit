import { SYSTEM_ROLE_PERMISSIONS } from '@gatefit/shared';
import { generateSync } from 'otplib';
import request from 'supertest';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  cookiesFrom,
  createStaff,
  createTestApp,
  hostOf,
  type StaffFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

describe('Staff sign-in (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let manager: StaffFixture;

  const http = () => request(t.app.getHttpServer());
  const login = (organization: Organization, body: object) =>
    http().post('/api/v1/auth/login').set('Host', hostOf(organization)).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');
    manager = await createStaff(admin, orgA, 'manager');
  });

  afterEach(() => {
    t.clock.reset();
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('phone and password', () => {
    it('signs in and sets httpOnly session cookies', async () => {
      const response = await login(orgA, { phone: manager.phone, password: manager.password });

      expect(response.status).toBe(204);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(2);
      const [access, refresh] = cookies;
      expect(access).toMatch(/^gf_staff_access=.+; .*Path=\/; .*HttpOnly; SameSite=Lax/);
      expect(refresh).toMatch(/^gf_staff_refresh=.+; .*Path=\/api\/v1\/auth; .*HttpOnly/);
    });

    it('returns the signed-in user, role, permissions and organization from /me', async () => {
      const agent = request.agent(t.app.getHttpServer());
      await agent
        .post('/api/v1/auth/login')
        .set('Host', hostOf(orgA))
        .send({ phone: manager.phone, password: manager.password })
        .expect(204);

      const response = await agent.get('/api/v1/me').set('Host', hostOf(orgA)).expect(200);
      expect(response.body).toEqual({
        audience: 'staff',
        user: { id: manager.userId, phone: manager.phone },
        organization: {
          id: orgA.id,
          name: orgA.name,
          slug: orgA.slug,
          locale: 'uz',
          currency: 'UZS',
        },
        staff: {
          id: manager.staffId,
          role: { id: manager.roleId, name: 'manager', isSystem: true },
          permissions: [...SYSTEM_ROLE_PERMISSIONS.manager].sort(),
          locations: [],
        },
      });
    });

    it('accepts a phone typed with spaces and dashes', async () => {
      const spaced = `${manager.phone.slice(0, 4)} ${manager.phone.slice(4, 6)}-${manager.phone.slice(6)}`;
      await login(orgA, { phone: spaced, password: manager.password }).expect(204);
    });

    it('answers a wrong password and an unknown phone identically', async () => {
      const wrongPassword = await login(orgA, { phone: manager.phone, password: 'nope' });
      const unknownPhone = await login(orgA, { phone: uniquePhone(), password: 'nope' });

      expect(wrongPassword.status).toBe(401);
      expect(wrongPassword.body).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid phone or password',
        details: null,
      });
      expect(unknownPhone.status).toBe(401);
      expect(unknownPhone.body).toEqual(wrongPassword.body);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });

    it("refuses staff of one organization on another organization's address", async () => {
      const response = await login(orgB, { phone: manager.phone, password: manager.password });
      expect(response.status).toBe(401);
      expect((response.body as { code: string }).code).toBe('INVALID_CREDENTIALS');
    });

    it('refuses deactivated staff', async () => {
      const inactive = await createStaff(admin, orgA, 'trainer');
      await admin.staff.update({ where: { id: inactive.staffId }, data: { status: 'inactive' } });

      await login(orgA, { phone: inactive.phone, password: inactive.password }).expect(401);
    });

    it('rejects a malformed body with VALIDATION_FAILED', async () => {
      const response = await login(orgA, { phone: '12345', password: '' }).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('limits attempts per phone number', async () => {
      const phone = uniquePhone();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await login(orgA, { phone, password: 'nope' }).expect(401);
      }
      const response = await login(orgA, { phone, password: 'nope' }).expect(429);
      expect(response.body).toMatchObject({
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: expect.any(Number) as number },
      });
    });
  });

  describe('organization address', () => {
    it('needs an organization subdomain', async () => {
      const response = await http()
        .post('/api/v1/auth/login')
        .set('Host', 'localhost')
        .send({ phone: manager.phone, password: manager.password })
        .expect(404);
      expect(response.body).toMatchObject({ code: 'ORGANIZATION_NOT_FOUND' });

      const me = await http().get('/api/v1/me').set('Host', 'localhost').expect(404);
      expect(me.body).toMatchObject({ code: 'ORGANIZATION_NOT_FOUND' });
    });

    it('answers 404 for an unknown organization', async () => {
      const response = await http().get('/api/v1/me').set('Host', 'no-such-gym.localhost');
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'ORGANIZATION_NOT_FOUND' });
    });

    it('answers 403 for a blocked organization', async () => {
      const blocked = await createOrganization(admin, 'Blocked');
      await admin.organization.update({ where: { id: blocked.id }, data: { status: 'blocked' } });

      const response = await login(blocked, { phone: manager.phone, password: manager.password });
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'ORGANIZATION_BLOCKED' });
    });
  });

  describe('cross-site requests', () => {
    it('rejects a state-changing request from a foreign origin', async () => {
      const response = await login(orgA, { phone: manager.phone, password: manager.password })
        .set('Origin', 'https://evil.example')
        .expect(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('accepts a request from the organization address itself', async () => {
      await login(orgA, { phone: manager.phone, password: manager.password })
        .set('Origin', `http://${hostOf(orgA)}`)
        .expect(204);
    });
  });

  describe('authenticator app (TOTP)', () => {
    let owner: StaffFixture;
    let secret: string;
    const codeNow = () => generateSync({ secret, epoch: t.clock.nowSeconds() });

    beforeAll(async () => {
      owner = await createStaff(admin, orgA, 'owner');
    });

    it('does not sign an owner in until an authenticator is set up', async () => {
      const response = await login(orgA, { phone: owner.phone, password: owner.password });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        code: 'TOTP_SETUP_REQUIRED',
        details: { setupToken: expect.any(String) as string },
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it("rejects a setup token on another organization's address", async () => {
      const refused = await login(orgA, { phone: owner.phone, password: owner.password });
      const { setupToken } = (refused.body as { details: { setupToken: string } }).details;

      await http()
        .post('/api/v1/auth/totp/setup')
        .set('Host', hostOf(orgB))
        .send({ setupToken })
        .expect(401);
    });

    it('enrols with a setup token and signs in once the first code is confirmed', async () => {
      const refused = await login(orgA, { phone: owner.phone, password: owner.password });
      const { setupToken } = (refused.body as { details: { setupToken: string } }).details;

      const setup = await http()
        .post('/api/v1/auth/totp/setup')
        .set('Host', hostOf(orgA))
        .send({ setupToken })
        .expect(200);
      const enrolment = setup.body as { secret: string; otpauthUrl: string; enrollToken: string };
      secret = enrolment.secret;
      expect(enrolment.otpauthUrl).toContain('otpauth://totp/');
      expect(enrolment.otpauthUrl).toContain(secret);

      const confirm = (code: string) =>
        http()
          .post('/api/v1/auth/totp/confirm')
          .set('Host', hostOf(orgA))
          .send({ enrollToken: enrolment.enrollToken, code });

      const wrong = await confirm('000000').expect(401);
      expect(wrong.body).toMatchObject({ code: 'INVALID_TOTP' });

      const confirmed = await confirm(codeNow()).expect(204);
      await http()
        .get('/api/v1/me')
        .set('Host', hostOf(orgA))
        .set('Cookie', cookiesFrom(confirmed))
        .expect(200);

      // Stored encrypted, never as the raw secret.
      const stored = await admin.staff.findUniqueOrThrow({ where: { id: owner.staffId } });
      expect(stored.totpSecret).toMatch(/^v1\./);
      expect(stored.totpSecret).not.toContain(secret);
    });

    it('then requires the code on every sign-in', async () => {
      t.clock.advance(60);
      const credentials = { phone: owner.phone, password: owner.password };

      const missing = await login(orgA, credentials).expect(401);
      expect(missing.body).toMatchObject({ code: 'TOTP_REQUIRED' });

      const wrong = await login(orgA, { ...credentials, totpCode: '000000' }).expect(401);
      expect(wrong.body).toMatchObject({ code: 'INVALID_TOTP' });

      await login(orgA, { ...credentials, totpCode: codeNow() }).expect(204);
    });

    it('accepts each code only once', async () => {
      t.clock.advance(120);
      const body = { phone: owner.phone, password: owner.password, totpCode: codeNow() };

      await login(orgA, body).expect(204);
      const replay = await login(orgA, body).expect(401);
      expect(replay.body).toMatchObject({ code: 'INVALID_TOTP' });
    });

    it('does not check the code before the password', async () => {
      t.clock.advance(180);
      const response = await login(orgA, {
        phone: owner.phone,
        password: 'wrong',
        totpCode: codeNow(),
      });
      expect(response.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('lets a signed-in staff member enable it voluntarily, without a new session', async () => {
      const trainer = await createStaff(admin, orgA, 'trainer');
      const session = await login(orgA, { phone: trainer.phone, password: trainer.password });
      const cookies = cookiesFrom(session);

      const setup = await http()
        .post('/api/v1/auth/totp/setup')
        .set('Host', hostOf(orgA))
        .set('Cookie', cookies)
        .send({})
        .expect(200);
      const enrolment = setup.body as { secret: string; enrollToken: string };

      const confirmed = await http()
        .post('/api/v1/auth/totp/confirm')
        .set('Host', hostOf(orgA))
        .send({
          enrollToken: enrolment.enrollToken,
          code: generateSync({ secret: enrolment.secret, epoch: t.clock.nowSeconds() }),
        })
        .expect(204);
      expect(confirmed.headers['set-cookie']).toBeUndefined();

      const next = await login(orgA, { phone: trainer.phone, password: trainer.password });
      expect(next.body).toMatchObject({ code: 'TOTP_REQUIRED' });
    });

    it('refuses to start setup without a setup token or a session', async () => {
      await http().post('/api/v1/auth/totp/setup').set('Host', hostOf(orgA)).send({}).expect(401);
    });

    it('never replaces an existing authenticator', async () => {
      t.clock.advance(240);
      const session = await login(orgA, {
        phone: owner.phone,
        password: owner.password,
        totpCode: codeNow(),
      });

      const response = await http()
        .post('/api/v1/auth/totp/setup')
        .set('Host', hostOf(orgA))
        .set('Cookie', cookiesFrom(session))
        .send({})
        .expect(409);
      expect(response.body).toMatchObject({ code: 'CONFLICT' });
    });
  });
});
