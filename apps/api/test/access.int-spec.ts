import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type AccessResultDto,
  type AccessSyncResultDto,
  addDays,
  type CheckInDto,
  decideEntry,
  isoWeekday,
  localDate,
  localTime,
  type MemberDto,
  type MembershipDto,
  type OccupancyDto,
  type OfflineSnapshotDto,
  type Page,
  parseAccessToken,
  type PlanDto,
  type QrTokenDto,
  type SaleDto,
} from '@gatefit/shared';
import request from 'supertest';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import { CheckInPartitionsJob } from '../src/modules/access/check-in-partitions.job';
import {
  apiAs,
  cookiesFor,
  cookiesFrom,
  createPlan,
  createStaff,
  createTestApp,
  hostOf,
  type StaffFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

const TZ = 'Asia/Tashkent';

describe('Entry control (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let two: Location;
  let ownerUser: StaffFixture;
  let receptionistUser: StaffFixture;
  let trainerUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  /** Works at One only. */
  let receptionist: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;

  type Api = ReturnType<typeof apiAs>;

  /** Sessions are tied to the clock: after moving it, sign in again. */
  const resign = async () => {
    owner = apiAs(t, orgA, await cookiesFor(t, orgA, ownerUser));
    receptionist = apiAs(t, orgA, await cookiesFor(t, orgA, receptionistUser));
  };

  const createPlanDto = async (body: object): Promise<PlanDto> =>
    (
      await owner
        .post('/plans', {
          name: `Plan ${randomUUID().slice(0, 8)}`,
          type: 'duration',
          durationValue: 1,
          durationUnit: 'month',
          priceMinor: '0',
          ...body,
        })
        .expect(201)
    ).body as PlanDto;

  const createMember = async (location = one): Promise<MemberDto> =>
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

  const sell = async (memberId: string, plan: PlanDto, body: object = {}): Promise<SaleDto> =>
    (
      await owner
        .post(`/members/${memberId}/memberships`, {
          planId: plan.id,
          locationId: one.id,
          ...body,
        })
        .expect(201)
    ).body as SaleDto;

  /** A member who signed in to the member app; returns a function that fetches their code. */
  const memberApp = async (member: MemberDto) => {
    const http = () => request(t.app.getHttpServer());
    await http()
      .post('/api/v1/auth/otp/request')
      .set('Host', hostOf(orgA))
      .send({ phone: member.phone })
      .expect(204);
    const signedIn = await http()
      .post('/api/v1/auth/otp/verify')
      .set('Host', hostOf(orgA))
      .set('x-gatefit-client', 'member')
      .send({ phone: member.phone, code: t.sms.lastCode(member.phone) })
      .expect(204);
    const cookies = cookiesFrom(signedIn);
    return async () =>
      (
        await http()
          .get('/api/v1/me/qr')
          .set('Host', hostOf(orgA))
          .set('x-gatefit-client', 'member')
          .set('Cookie', cookies)
          .expect(200)
      ).body as QrTokenDto;
  };

  const verify = async (token: string, location = one, as: Api = receptionist) =>
    (await as.post('/access/verify', { token, locationId: location.id }).expect(200))
      .body as AccessResultDto;

  /** A member with a free membership of `plan` (or a default one) and their code. */
  const memberWith = async (plan?: PlanDto, sale: object = {}) => {
    const member = await createMember();
    await sell(member.id, plan ?? (await createPlanDto({})), sale);
    const qr = await memberApp(member);
    return { member, qr };
  };

  const checkInsOf = (memberId: string) =>
    admin.checkIn.findMany({ where: { memberId }, orderBy: { at: 'asc' } });

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
    const location = (name: string) =>
      admin.location.create({ data: { organizationId: orgA.id, name, timezone: TZ } });
    one = await location('One');
    two = await location('Two');
    ownerUser = await createStaff(admin, orgA, 'owner');
    receptionistUser = await createStaff(admin, orgA, 'receptionist');
    trainerUser = await createStaff(admin, orgA, 'trainer');
    for (const staff of [receptionistUser, trainerUser]) {
      await admin.staffLocation.create({
        data: { organizationId: orgA.id, staffId: staff.staffId, locationId: one.id },
      });
    }
    await resign();
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));
  });

  afterEach(async () => {
    t.clock.reset();
    await resign();
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('member QR code', () => {
    it('gives the member a signed code that changes every 30 seconds', async () => {
      const { member, qr } = await memberWith();
      const first = await qr();
      const parsed = parseAccessToken(first.token);
      expect(parsed?.payload).toMatchObject({ o: orgA.id, m: member.id });
      expect(new Date(first.expiresAt).getTime() - new Date(first.refreshAt).getTime()).toBe(
        30_000,
      );
      t.clock.advance(31);
      const second = await qr();
      expect(second.token).not.toBe(first.token);
    });

    it('is only for members, not staff', async () => {
      await owner.get('/me/qr').expect(403);
    });
  });

  describe('checking a code (acceptance criterion 4)', () => {
    it('lets a member with an active membership in, fast, and records it', async () => {
      const { member, qr } = await memberWith();
      const started = Date.now();
      const result = await verify((await qr()).token);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result).toMatchObject({
        allowed: true,
        reason: null,
        repeat: false,
        member: { id: member.id, firstName: 'Aziz' },
        membership: { daysLeft: expect.any(Number) as number, visitsLeft: null },
      });
      const rows = await checkInsOf(member.id);
      expect(rows).toEqual([
        expect.objectContaining({
          id: result.checkInId,
          locationId: one.id,
          direction: 'in',
          method: 'qr',
          result: 'allowed',
          membershipId: result.membership?.id,
        }),
      ]);
    });

    it('refuses an expired membership with the reason', async () => {
      const plan = await createPlanDto({ durationValue: 3, durationUnit: 'day' });
      const member = await createMember();
      await sell(member.id, plan);
      t.clock.advance(4 * 24 * 60 * 60);
      await resign();
      // Signed in after the clock moved: sessions are tied to it.
      const qr = await memberApp(member);
      expect(await verify((await qr()).token)).toMatchObject({
        allowed: false,
        reason: 'membership_expired',
      });
    });

    it('refuses a frozen membership', async () => {
      const plan = await createPlanDto({
        freeze: { maxDays: 30, maxTimes: 2, minDays: 1, feeMinor: '0' },
      });
      const { member, qr } = await memberWith(plan);
      const [membership] = (
        (await owner.get(`/members/${member.id}/memberships`).expect(200))
          .body as Page<MembershipDto>
      ).items;
      await owner
        .post(`/memberships/${membership?.id ?? ''}/freeze`, {
          startsOn: localDate(t.clock.now(), TZ),
          days: 5,
          reason: 'Trip',
          source: 'staff',
        })
        .expect(200);
      expect((await verify((await qr()).token)).reason).toBe('membership_frozen');
    });

    it('refuses outside the plan hours and on other days', async () => {
      const now = localTime(t.clock.now(), TZ);
      const window =
        now < '23:00' ? { from: '23:00', to: '24:00' } : { from: '00:00', to: '01:00' };
      const hours = await createPlanDto({
        restrictions: {
          timeWindows: [window],
          weekdays: [],
          dailyVisitLimit: null,
          locationIds: [],
        },
      });
      expect((await verify((await (await memberWith(hours)).qr()).token)).reason).toBe(
        'outside_hours',
      );

      const today = isoWeekday(localDate(t.clock.now(), TZ));
      const days = await createPlanDto({
        restrictions: {
          timeWindows: [],
          weekdays: [today === 1 ? 2 : 1],
          dailyVisitLimit: null,
          locationIds: [],
        },
      });
      expect((await verify((await (await memberWith(days)).qr()).token)).reason).toBe('wrong_day');
    });

    it('refuses at a location the membership does not cover', async () => {
      const plan = await createPlanDto({
        restrictions: {
          timeWindows: [],
          weekdays: [],
          dailyVisitLimit: null,
          locationIds: [one.id],
        },
      });
      const { qr } = await memberWith(plan);
      expect((await verify((await qr()).token, two, owner)).reason).toBe('wrong_location');
      expect((await verify((await qr()).token, one, owner)).allowed).toBe(true);
    });

    it('refuses a membership that has not started, and a member without one', async () => {
      const today = localDate(t.clock.now(), TZ);
      const { qr } = await memberWith(undefined, { startsOn: addDays(today, 3) });
      expect((await verify((await qr()).token)).reason).toBe('membership_not_started');

      const bare = await createMember();
      expect((await verify((await (await memberApp(bare))()).token)).reason).toBe('no_membership');
    });

    it('refuses blocked members and debtors whatever they hold', async () => {
      const blocked = await memberWith();
      await owner.post(`/members/${blocked.member.id}/block`, { reason: 'Rules' }).expect(200);
      expect((await verify((await blocked.qr()).token)).reason).toBe('member_blocked');

      const priced = await createPlanDto({ priceMinor: '10000000' });
      const debtor = await memberWith(priced);
      expect((await verify((await debtor.qr()).token)).reason).toBe('debt');
    });

    it('enforces the daily limit; a second scan right away is not a new visit', async () => {
      const plan = await createPlanDto({
        restrictions: { timeWindows: [], weekdays: [], dailyVisitLimit: 1, locationIds: [] },
      });
      const { member, qr } = await memberWith(plan);
      const first = await verify((await qr()).token);
      const again = await verify((await qr()).token);
      expect(again).toMatchObject({ allowed: true, repeat: true, checkInId: first.checkInId });
      expect(await checkInsOf(member.id)).toHaveLength(1);

      t.clock.advance(6 * 60);
      await resign();
      expect((await verify((await qr()).token)).reason).toBe('daily_limit');
    });

    it('spends a visit of a visit-count membership; the last one ends it', async () => {
      const plan = await createPlanDto({ type: 'visits', visitLimit: 2 });
      const { member, qr } = await memberWith(plan);
      expect((await verify((await qr()).token)).membership?.visitsLeft).toBe(1);
      t.clock.advance(6 * 60);
      await resign();
      expect((await verify((await qr()).token)).membership?.visitsLeft).toBe(0);
      t.clock.advance(6 * 60);
      await resign();
      expect((await verify((await qr()).token)).reason).toBe('membership_expired');
      const [membership] = (
        (await owner.get(`/members/${member.id}/memberships`).expect(200))
          .body as Page<MembershipDto>
      ).items;
      expect(membership).toMatchObject({ status: 'expired', visitsLeft: 0 });
    });

    it('prefers an unlimited membership to one with visits', async () => {
      const member = await createMember();
      const visits = await createPlanDto({ type: 'visits', visitLimit: 10 });
      await sell(member.id, visits);
      await sell(member.id, await createPlanDto({}));
      const result = await verify((await (await memberApp(member))()).token);
      expect(result.membership).toMatchObject({ visitsLeft: null });
    });
  });

  describe('stale and forged codes (acceptance criterion 5)', () => {
    it('refuses a screenshot older than 60 seconds and records the attempt', async () => {
      const { member, qr } = await memberWith();
      const code = await qr();
      const issuedAt = (parseAccessToken(code.token)?.payload.i ?? 0) * 1000;
      t.clock.set(new Date(issuedAt + 55_000));
      await resign();
      expect((await verify(code.token)).allowed).toBe(true);
      t.clock.set(new Date(issuedAt + 65_000));
      await resign();
      expect(await verify(code.token, two, owner)).toMatchObject({
        allowed: false,
        reason: 'expired_code',
        member: { id: member.id },
      });
      expect((await checkInsOf(member.id)).map((row) => row.denyReason)).toEqual([
        null,
        'expired_code',
      ]);
    });

    it('refuses a tampered code and a code of another organization, recording nothing', async () => {
      const { member, qr } = await memberWith();
      const { token } = await qr();
      const [prefix, payload, signature = ''] = token.split('.');
      const flipped = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
      expect(await verify(`${prefix}.${payload}.${flipped}`)).toMatchObject({
        allowed: false,
        reason: 'invalid_code',
        member: null,
        checkInId: null,
      });
      expect((await verify('not a code')).reason).toBe('invalid_code');

      const locationB = await admin.location.create({
        data: { organizationId: orgB.id, name: 'B1', timezone: TZ },
      });
      expect((await verify(token, locationB, ownerB)).reason).toBe('invalid_code');
      expect(await checkInsOf(member.id)).toEqual([]);
    });
  });

  describe('by hand, leaving and who is inside', () => {
    it('lets a member in by hand with a reason, even without a membership, and audits it', async () => {
      const member = await createMember();
      await receptionist
        .post('/access/manual', { memberId: member.id, locationId: one.id })
        .expect(400);
      const result = (
        await receptionist
          .post('/access/manual', { memberId: member.id, locationId: one.id, reason: 'Phone died' })
          .expect(200)
      ).body as AccessResultDto;
      expect(result).toMatchObject({ allowed: true, membership: null });
      const [row] = await checkInsOf(member.id);
      expect(row).toMatchObject({ method: 'manual', result: 'allowed', note: 'Phone died' });
      const audit = await admin.auditLog.findMany({
        where: {
          organizationId: orgA.id,
          action: 'check_in.manual',
          entityId: result.checkInId ?? '',
        },
      });
      expect(audit[0]?.after).toMatchObject({ reason: 'Phone died', refusal: 'no_membership' });
    });

    it('keeps staff to their own locations', async () => {
      const { qr } = await memberWith();
      await receptionist
        .post('/access/verify', { token: (await qr()).token, locationId: two.id })
        .expect(403);
      const member = await createMember();
      await receptionist
        .post('/access/manual', { memberId: member.id, locationId: two.id, reason: 'x' })
        .expect(403);
    });

    it('needs the right permission', async () => {
      const trainer = apiAs(t, orgA, await cookiesFor(t, orgA, trainerUser));
      const { qr } = await memberWith();
      await trainer
        .post('/access/verify', { token: (await qr()).token, locationId: one.id })
        .expect(403);
      await trainer.get(`/check-ins?locationId=${one.id}`).expect(200);
    });

    it('counts who is inside: in, out, and gone after three hours', async () => {
      const location = await admin.location.create({
        data: { organizationId: orgA.id, name: `Count ${randomUUID().slice(0, 6)}`, timezone: TZ },
      });
      const occupancy = async () =>
        ((await owner.get(`/locations/${location.id}/occupancy`).expect(200)).body as OccupancyDto)
          .count;
      const a = await memberWith();
      const b = await memberWith();
      await verify((await a.qr()).token, location, owner);
      await verify((await b.qr()).token, location, owner);
      expect(await occupancy()).toBe(2);
      await owner
        .post('/access/exit', { memberId: a.member.id, locationId: location.id })
        .expect(200);
      expect(await occupancy()).toBe(1);
      t.clock.advance(3 * 60 * 60 + 60);
      await resign();
      expect(await occupancy()).toBe(0);
    });
  });

  describe('journal', () => {
    it('lists entries newest first, filtered, within the caller locations', async () => {
      const { member, qr } = await memberWith();
      await verify((await qr()).token, one, owner);
      t.clock.advance(6 * 60);
      await resign();
      await verify((await qr()).token, two, owner);
      const all = (await owner.get(`/check-ins?memberId=${member.id}`).expect(200))
        .body as Page<CheckInDto>;
      expect(all.items.map((item) => item.location.name)).toEqual(['Two', 'One']);
      expect(all.items[0]?.member).toMatchObject({ firstName: 'Aziz', lastName: 'Karimov' });
      const mine = (await receptionist.get(`/check-ins?memberId=${member.id}`).expect(200))
        .body as Page<CheckInDto>;
      expect(mine.items.map((item) => item.location.name)).toEqual(['One']);
      await receptionist.get(`/check-ins?locationId=${two.id}`).expect(403);
    });
  });

  describe('offline reception screen (acceptance criterion 11)', () => {
    it('gives the screen a public key and the members, and the key checks codes', async () => {
      const { member, qr } = await memberWith();
      const snapshot = (await receptionist.get(`/access/offline?locationId=${one.id}`).expect(200))
        .body as OfflineSnapshotDto;
      const entry = snapshot.members.find((item) => item.id === member.id);
      expect(entry?.memberships).toHaveLength(1);

      // What the screen does with no internet: check the signature, then the rules.
      const parsed = parseAccessToken((await qr()).token);
      const key = createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: snapshot.publicKey },
        format: 'jwk',
      });
      expect(
        parsed &&
          verifySignature(
            null,
            Buffer.from(parsed.signingInput),
            key,
            Buffer.from(parsed.signature),
          ),
      ).toBe(true);
      const decision = decideEntry(entry?.status ?? '', entry?.memberships ?? [], {
        locationId: one.id,
        locationTimeZone: TZ,
        now: t.clock.now(),
        visitsToday: () => 0,
      });
      expect(decision.allowed).toBe(true);
    });

    it('takes entries made offline once, spending visits; resending changes nothing', async () => {
      const plan = await createPlanDto({ type: 'visits', visitLimit: 5 });
      const { member } = await memberWith(plan);
      const snapshot = (await receptionist.get(`/access/offline?locationId=${one.id}`).expect(200))
        .body as OfflineSnapshotDto;
      const membershipId = snapshot.members.find((item) => item.id === member.id)?.memberships[0]
        ?.id;
      const batch = {
        locationId: one.id,
        checkIns: [
          {
            id: randomUUID(),
            at: new Date(t.clock.now().getTime() - 10 * 60 * 1000).toISOString(),
            memberId: member.id,
            membershipId,
            result: 'allowed',
            denyReason: null,
          },
        ],
      };
      expect((await receptionist.post('/access/sync', batch).expect(200)).body).toEqual({
        recorded: 1,
        duplicates: 0,
      } satisfies AccessSyncResultDto);
      expect((await receptionist.post('/access/sync', batch).expect(200)).body).toEqual({
        recorded: 0,
        duplicates: 1,
      });
      const [row] = await checkInsOf(member.id);
      expect(row).toMatchObject({ method: 'qr_offline', result: 'allowed' });
      const [membership] = (
        (await owner.get(`/members/${member.id}/memberships`).expect(200))
          .body as Page<MembershipDto>
      ).items;
      expect(membership?.visitsLeft).toBe(4);

      await receptionist
        .post('/access/sync', {
          locationId: one.id,
          checkIns: [{ ...batch.checkIns[0], id: randomUUID(), at: '2020-01-01T00:00:00Z' }],
        })
        .expect(422);
    });
  });

  describe('live feed', () => {
    it('sends each entry and the head count to the screens of the location', async () => {
      const server = t.app.getHttpServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      const cookies = await cookiesFor(t, orgA, ownerUser);
      const received: string[] = [];
      const feed = httpRequest({
        port,
        path: `/api/v1/access/events?locationId=${one.id}`,
        headers: { Host: hostOf(orgA), Cookie: cookies.join('; ') },
      });
      const gotEntry = new Promise<void>((resolve, reject) => {
        feed.on('response', (res) => {
          expect(res.headers['content-type']).toContain('text/event-stream');
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            received.push(chunk);
            if (received.join('').includes('event: check-in')) {
              resolve();
            }
          });
        });
        feed.on('error', reject);
      });
      feed.end();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { member, qr } = await memberWith();
      await verify((await qr()).token);
      await gotEntry;
      feed.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      const text = received.join('');
      expect(text).toContain('event: occupancy');
      expect(text).toContain(member.id);
    });
  });

  describe('isolation and immutability (acceptance criterion 10)', () => {
    it('does not show one organization the entries of another', async () => {
      const { member, qr } = await memberWith();
      await verify((await qr()).token);
      const page = (await ownerB.get(`/check-ins?memberId=${member.id}`).expect(200))
        .body as Page<CheckInDto>;
      expect(page.items).toEqual([]);
      await ownerB.get(`/locations/${one.id}/occupancy`).expect(422);
    });

    it('never lets the API change or delete an entry', async () => {
      const { member, qr } = await memberWith();
      await verify((await qr()).token);
      const appDb = t.app.get(TenantDb);
      await expect(
        appDb.run(
          orgA.id,
          (tx) =>
            tx.$executeRaw`UPDATE check_ins SET result = 'denied' WHERE member_id = ${member.id}::uuid`,
        ),
      ).rejects.toThrow();
      await expect(
        appDb.run(
          orgA.id,
          (tx) => tx.$executeRaw`DELETE FROM check_ins WHERE member_id = ${member.id}::uuid`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('partitions', () => {
    it('creates the coming months and does nothing the second time', async () => {
      const job = t.app.get(CheckInPartitionsJob);
      await job.run(new Date('2027-10-15T00:00:00Z'));
      expect(await job.run(new Date('2027-10-15T00:00:00Z'))).toBe(0);
      const partitions = await admin.$queryRaw<{ name: string }[]>`
        SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'check_ins'::regclass AND c.relname = 'check_ins_y2028m01'`;
      expect(partitions).toHaveLength(1);
    });
  });

  describe('speed', () => {
    it('answers a code check in under 500 ms at the 95th percentile', async () => {
      const members = await Promise.all(Array.from({ length: 5 }, () => memberWith()));
      const timings: number[] = [];
      for (let round = 0; round < 8; round += 1) {
        for (const { qr } of members) {
          const { token } = await qr();
          const started = performance.now();
          await verify(token, one, owner);
          timings.push(performance.now() - started);
        }
      }
      timings.sort((a, b) => a - b);
      const p95 = timings[Math.ceil(timings.length * 0.95) - 1] ?? Infinity;
      expect(p95).toBeLessThan(500);
    });
  });
});
