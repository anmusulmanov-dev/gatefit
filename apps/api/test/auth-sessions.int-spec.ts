import request, { type Response } from 'supertest';
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

const ACCESS_TTL = 15 * 60;

describe('Sessions and tokens (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let manager: StaffFixture;

  const http = () => request(t.app.getHttpServer());
  const signIn = async (): Promise<string[]> =>
    cookiesFrom(
      await http()
        .post('/api/v1/auth/login')
        .set('Host', hostOf(orgA))
        .send({ phone: manager.phone, password: manager.password })
        .expect(204),
    );
  const me = (cookies: string[], organization = orgA) =>
    http().get('/api/v1/me').set('Host', hostOf(organization)).set('Cookie', cookies);
  const refresh = (cookies: string[]) =>
    http().post('/api/v1/auth/refresh').set('Host', hostOf(orgA)).set('Cookie', cookies);
  const expectSignedOut = (response: Response) => {
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
  };

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

  describe('access token', () => {
    it('is required', async () => {
      expectSignedOut(await me([]));
    });

    it('expires after 15 minutes', async () => {
      const cookies = await signIn();
      t.clock.advance(ACCESS_TTL - 5);
      await me(cookies).expect(200);

      t.clock.advance(10);
      expectSignedOut(await me(cookies));
    });

    it('is rejected when tampered with', async () => {
      const [access = '', refreshCookie = ''] = await signIn();
      const forged = `${access.slice(0, -3)}${access.endsWith('AAA') ? 'BBB' : 'AAA'}`;
      expectSignedOut(await me([forged, refreshCookie]));
    });

    it("is worthless on another organization's address", async () => {
      const cookies = await signIn();
      expectSignedOut(await me(cookies, orgB));
    });

    it('issued to staff is not accepted as a member session', async () => {
      const [access = ''] = await signIn();
      const disguised = access.replace('gf_staff_access', 'gf_member_access');

      const response = await http()
        .get('/api/v1/me')
        .set('Host', hostOf(orgA))
        .set('x-gatefit-client', 'member')
        .set('Cookie', [disguised]);
      expectSignedOut(response);
    });

    it('stops working as soon as the staff member is deactivated', async () => {
      const trainer = await createStaff(admin, orgA, 'trainer');
      const cookies = cookiesFrom(
        await http()
          .post('/api/v1/auth/login')
          .set('Host', hostOf(orgA))
          .send({ phone: trainer.phone, password: trainer.password }),
      );
      await me(cookies).expect(200);

      await admin.staff.update({ where: { id: trainer.staffId }, data: { status: 'inactive' } });
      expectSignedOut(await me(cookies));
    });
  });

  describe('refresh token rotation', () => {
    it('issues a new pair and keeps the session alive past access expiry', async () => {
      const cookies = await signIn();
      t.clock.advance(ACCESS_TTL + 60);
      expectSignedOut(await me(cookies));

      const rotated = await refresh(cookies).expect(204);
      const fresh = cookiesFrom(rotated);
      expect(fresh).toHaveLength(2);
      expect(fresh).not.toEqual(cookies);
      await me(fresh).expect(200);
    });

    it('treats reuse of a rotated token as theft and ends the whole session', async () => {
      const original = await signIn();
      const fresh = cookiesFrom(await refresh(original).expect(204));
      await me(fresh).expect(200);

      // Well after the short window that tolerates two tabs refreshing at once.
      t.clock.advance(60);
      expectSignedOut(await refresh(original));

      // The legitimate holder of the newer pair is signed out too.
      expectSignedOut(await me(fresh));
      expectSignedOut(await refresh(fresh));
    });

    it('tolerates two tabs refreshing at the same moment', async () => {
      const original = await signIn();
      const fresh = cookiesFrom(await refresh(original).expect(204));

      // The second tab loses the race: it is refused, but nothing is revoked.
      expectSignedOut(await refresh(original));
      await me(fresh).expect(200);
    });

    it('lets only one of two concurrent refreshes win', async () => {
      const original = await signIn();
      const results = await Promise.all([refresh(original), refresh(original)]);

      expect(results.map((response) => response.status).sort()).toEqual([204, 401]);
      const winner = results.find((response) => response.status === 204);
      await me(cookiesFrom(winner as Response)).expect(200);
    });

    it('refuses a missing, unknown or expired refresh token', async () => {
      expectSignedOut(await refresh([]));
      expectSignedOut(await refresh(['gf_staff_refresh=not-a-real-token']));

      const cookies = await signIn();
      t.clock.advance(30 * 24 * 60 * 60 + 1);
      expectSignedOut(await refresh(cookies));
    });

    it('stores the refresh token only as a hash', async () => {
      const [, refreshCookie = ''] = await signIn();
      const token = refreshCookie.split('=')[1] ?? '';

      const sessions = await admin.session.findMany({ where: { userId: manager.userId } });
      expect(sessions.length).toBeGreaterThan(0);
      for (const session of sessions) {
        expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(session.refreshTokenHash).not.toBe(token);
      }
    });
  });

  describe('signing out', () => {
    it('logout ends this session immediately and clears the cookies', async () => {
      const cookies = await signIn();
      const other = await signIn();

      const response = await http()
        .post('/api/v1/auth/logout')
        .set('Host', hostOf(orgA))
        .set('Cookie', cookies)
        .expect(204);
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^gf_staff_access=;/),
          expect.stringMatching(/^gf_staff_refresh=;/),
        ]),
      );

      expectSignedOut(await me(cookies));
      expectSignedOut(await refresh(cookies));
      // Another device of the same user is unaffected.
      await me(other).expect(200);
    });

    it('logout works without a session', async () => {
      await http().post('/api/v1/auth/logout').set('Host', hostOf(orgA)).expect(204);
    });

    it('logout-all ends every session of the user, and only theirs', async () => {
      const first = await signIn();
      const second = await signIn();
      const colleague = await createStaff(admin, orgA, 'receptionist');
      const colleagueCookies = cookiesFrom(
        await http()
          .post('/api/v1/auth/login')
          .set('Host', hostOf(orgA))
          .send({ phone: colleague.phone, password: colleague.password }),
      );

      await http()
        .post('/api/v1/auth/logout-all')
        .set('Host', hostOf(orgA))
        .set('Cookie', first)
        .expect(204);

      expectSignedOut(await me(first));
      expectSignedOut(await me(second));
      expectSignedOut(await refresh(second));
      await me(colleagueCookies).expect(200);
    });

    it('logout-all requires a session', async () => {
      expectSignedOut(await http().post('/api/v1/auth/logout-all').set('Host', hostOf(orgA)));
    });
  });

  it('keeps staff and member sessions of one browser apart', async () => {
    const staffCookies = await signIn();
    const phone = uniquePhone();
    await http().post('/api/v1/auth/otp/request').set('Host', hostOf(orgA)).send({ phone });
    const memberCookies = cookiesFrom(
      await http()
        .post('/api/v1/auth/otp/verify')
        .set('Host', hostOf(orgA))
        .send({ phone, code: t.sms.lastCode(phone) }),
    );
    const both = [...staffCookies, ...memberCookies];

    const asStaff = await me(both).expect(200);
    const asMember = await me(both).set('x-gatefit-client', 'member').expect(200);
    expect(asStaff.body).toMatchObject({ audience: 'staff', user: { phone: manager.phone } });
    expect(asMember.body).toMatchObject({ audience: 'member', user: { phone } });
  });
});
