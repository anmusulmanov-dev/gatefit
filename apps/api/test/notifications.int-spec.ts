import {
  addDays,
  type DailyReportDto,
  localDate,
  type MemberDto,
  type NotificationDto,
  type NotificationTemplateDto,
  type Page,
  type PlanDto,
  type SaleDto,
  startOfLocalDay,
} from '@gatefit/shared';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ExpiryReminderJob } from '../src/modules/plans/expiry-reminder.job';
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

const TZ = 'Asia/Tashkent';
const PRICE = '45000000';

describe('Notifications and the daily report (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let ownerUser: StaffFixture;
  let receptionistUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  let receptionist: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;
  let monthly: PlanDto;

  const resign = async () => {
    owner = apiAs(t, orgA, await cookiesFor(t, orgA, ownerUser));
    receptionist = apiAs(t, orgA, await cookiesFor(t, orgA, receptionistUser));
  };

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
        .post(`/members/${memberId}/memberships`, { planId: plan.id, locationId: one.id, ...body })
        .expect(201)
    ).body as SaleDto;

  const notificationsOf = (memberId: string) =>
    admin.notification.findMany({ where: { memberId }, orderBy: { createdAt: 'asc' } });

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
      data: { organizationId: orgA.id, name: 'One', timezone: TZ },
    });
    ownerUser = await createStaff(admin, orgA, 'owner');
    receptionistUser = await createStaff(admin, orgA, 'receptionist');
    await admin.staffLocation.create({
      data: { organizationId: orgA.id, staffId: receptionistUser.staffId, locationId: one.id },
    });
    await resign();
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));
    monthly = (
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

  afterEach(async () => {
    t.clock.reset();
    t.sms.failNext = 0;
    await resign();
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('receipts through the queue and the club’s wording', () => {
    it('logs the receipt and sends it; the member card lists it', async () => {
      const member = await createMember();
      const sale = await sell(member.id, monthly, {
        payment: { method: 'card_terminal', amountMinor: PRICE },
      });
      await receptionist.post(`/payments/${sale.payment?.id ?? ''}/receipt/sms`).expect(204);
      const sms = await t.sms.waitFor(member.phone);
      expect(sms.text).toContain(sale.invoice?.number);

      const page = (await receptionist.get(`/notifications?memberId=${member.id}`).expect(200))
        .body as Page<NotificationDto>;
      expect(page.items).toEqual([
        expect.objectContaining({ kind: 'payment_receipt', to: member.phone, body: sms.text }),
      ]);
      // The list waits for the worker to record the send.
      for (let i = 0; i < 50; i += 1) {
        const [row] = await notificationsOf(member.id);
        if (row?.status === 'sent') {
          expect(row).toMatchObject({ attempts: 1, lastError: null });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('The receipt was not marked as sent');
    });

    it('uses the club’s template, refuses unknown placeholders and goes back to the standard', async () => {
      const templates = (await owner.get('/notification-templates').expect(200))
        .body as NotificationTemplateDto[];
      expect(templates).toHaveLength(6);
      expect(
        templates.find((item) => item.key === 'payment_receipt' && item.locale === 'uz'),
      ).toMatchObject({
        isDefault: true,
        variables: ['organization', 'amount', 'number', 'balance'],
      });

      await owner
        .put('/notification-templates/payment_receipt/uz', { body: 'Rahmat! {amount} {nope}' })
        .expect(422)
        .expect((res) => {
          expect(res.body).toMatchObject({
            code: 'INVALID_TEMPLATE',
            details: { unknown: ['nope'] },
          });
        });
      await receptionist
        .put('/notification-templates/payment_receipt/uz', { body: 'x' })
        .expect(403);
      await owner
        .put('/notification-templates/payment_receipt/uz', {
          body: 'Rahmat! {amount} qabul qilindi.',
        })
        .expect(200);

      const member = await createMember();
      const sale = await sell(member.id, monthly, {
        payment: { method: 'card_terminal', amountMinor: PRICE },
      });
      await owner.post(`/payments/${sale.payment?.id ?? ''}/receipt/sms`).expect(204);
      expect((await t.sms.waitFor(member.phone)).text).toMatch(/^Rahmat! .+ qabul qilindi\.$/);

      const reset = (
        await owner.put('/notification-templates/payment_receipt/uz', { body: null }).expect(200)
      ).body as NotificationTemplateDto;
      expect(reset.isDefault).toBe(true);
      const audit = await admin.auditLog.findMany({
        where: { organizationId: orgA.id, action: 'notification_template.update' },
      });
      expect(audit).toHaveLength(2);
    });

    it('retries a failed send and gives up after the last attempt', async () => {
      const member = await createMember();
      const row = await admin.notification.create({
        data: {
          organizationId: orgA.id,
          memberId: member.id,
          kind: 'payment_receipt',
          to: member.phone,
          body: 'Test',
        },
      });
      const service = t.app.get(NotificationsService);
      const job = { organizationId: orgA.id, notificationId: row.id };

      t.sms.failNext = 1;
      await expect(service.deliver(job, 0)).rejects.toThrow('Provider unavailable');
      expect(await admin.notification.findUnique({ where: { id: row.id } })).toMatchObject({
        status: 'queued',
        attempts: 1,
        lastError: 'Provider unavailable',
      });
      await service.deliver(job, 1);
      expect(await admin.notification.findUnique({ where: { id: row.id } })).toMatchObject({
        status: 'sent',
        attempts: 2,
      });
      // Already sent: a late retry sends nothing more.
      await service.deliver(job, 2);
      expect(t.sms.sent.filter((sms) => sms.to === member.phone)).toHaveLength(1);

      const other = await admin.notification.create({
        data: { organizationId: orgA.id, kind: 'payment_receipt', to: uniquePhone(), body: 'Test' },
      });
      t.sms.failNext = 1;
      await expect(
        service.deliver({ organizationId: orgA.id, notificationId: other.id }, 3),
      ).rejects.toThrow();
      expect((await admin.notification.findUnique({ where: { id: other.id } }))?.status).toBe(
        'failed',
      );
    });
  });

  describe('expiry reminder', () => {
    it('reminds three days before the end, from 10:00 local time, once', async () => {
      const today = localDate(new Date(), TZ);
      // 09:30 in Tashkent, today.
      t.clock.set(new Date(startOfLocalDay(today, TZ).getTime() + 9.5 * 60 * 60 * 1000));
      await resign();
      const fourDays = (
        await owner
          .post('/plans', {
            name: 'Four days',
            type: 'duration',
            durationValue: 4,
            durationUnit: 'day',
            priceMinor: '0',
          })
          .expect(201)
      ).body as PlanDto;
      const member = await createMember();
      const sale = await sell(member.id, fourDays);
      expect(sale.membership.endsOn).toBe(addDays(today, 3));

      const job = t.app.get(ExpiryReminderJob);
      await job.run();
      expect(await notificationsOf(member.id)).toEqual([]);

      t.clock.set(new Date(startOfLocalDay(today, TZ).getTime() + 10.5 * 60 * 60 * 1000));
      expect(await job.run()).toBeGreaterThanOrEqual(1);
      await job.run();
      const sent = await notificationsOf(member.id);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        kind: 'expiry_reminder',
        dedupeKey: `expiry:${sale.membership.id}:${addDays(today, 3)}`,
      });
      expect(sent[0]?.body).toContain('Four days');
      expect(sent[0]?.body).toContain(addDays(today, 3).split('-').reverse().join('.'));
    });
  });

  describe('daily report (docs/TZ.md F-8.1)', () => {
    it('sums the day’s takings by method, new members, visits and memberships ending soon', async () => {
      const location = await admin.location.create({
        data: { organizationId: orgA.id, name: 'Report', timezone: TZ },
      });
      const sellHere = async (memberId: string, method: string, amountMinor: string) =>
        (
          await owner
            .post(`/members/${memberId}/memberships`, {
              planId: monthly.id,
              locationId: location.id,
              payment: { method, amountMinor },
            })
            .expect(201)
        ).body as SaleDto;
      const first = await createMember(location);
      const second = await createMember(location);
      const cardSale = await sellHere(first.id, 'card_terminal', PRICE);
      await sellHere(second.id, 'transfer', '20000000');
      await owner
        .post(`/payments/${cardSale.payment?.id ?? ''}/refund`, {
          amountMinor: '5000000',
          reason: 'Goodwill',
        })
        .expect(201);
      await owner
        .post('/access/manual', { memberId: first.id, locationId: location.id, reason: 'Test' })
        .expect(200);
      await owner
        .post('/access/manual', { memberId: second.id, locationId: location.id, reason: 'Test' })
        .expect(200);

      const report = (await owner.get(`/reports/daily?locationId=${location.id}`).expect(200))
        .body as DailyReportDto;
      expect(report).toMatchObject({
        date: localDate(new Date(), TZ),
        currency: 'UZS',
        revenue: [
          { method: 'card_terminal', count: 1, amountMinor: PRICE },
          { method: 'transfer', count: 1, amountMinor: '20000000' },
        ],
        refundsMinor: '5000000',
        netMinor: '60000000',
        newMembers: 2,
        visits: { entries: 2, members: 2, refused: 0 },
        expiring: [],
      });

      const yesterday = addDays(localDate(new Date(), TZ), -1);
      const before = (
        await owner.get(`/reports/daily?locationId=${location.id}&date=${yesterday}`).expect(200)
      ).body as DailyReportDto;
      expect(before).toMatchObject({ revenue: [], netMinor: '0', newMembers: 0 });
      // Ending within a week of a day a month from now.
      const later = (
        await owner
          .get(
            `/reports/daily?locationId=${location.id}&date=${addDays(cardSale.membership.endsOn, -3)}`,
          )
          .expect(200)
      ).body as DailyReportDto;
      expect(later.expiring.map((item) => item.member.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
    });

    it('keeps staff to their locations and organizations apart', async () => {
      const other = await admin.location.create({
        data: { organizationId: orgA.id, name: 'Elsewhere', timezone: TZ },
      });
      await receptionist.get(`/reports/daily?locationId=${other.id}`).expect(403);
      await ownerB.get(`/reports/daily?locationId=${one.id}`).expect(422);
      const member = await createMember();
      await ownerB.get(`/notifications?memberId=${member.id}`).expect(404);
    });
  });
});
