import {
  addDays,
  type CashShiftDto,
  type InvoiceDto,
  localDate,
  type MemberDto,
  type Page,
  type PaymentDto,
  type PlanDto,
  type ReceiptDto,
  type RefundDto,
  type SaleDto,
  startOfLocalDay,
} from '@gatefit/shared';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import { DebtStatusJob } from '../src/modules/billing/debt-status.job';
import { InvoicesService } from '../src/modules/billing/invoices.service';
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

const PRICE = '45000000';

describe('Payments and cash desk (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let two: Location;
  let ownerUser: StaffFixture;
  let owner: ReturnType<typeof apiAs>;
  /** Works at One only: takes payments, runs the cash desk, cannot refund. */
  let receptionist: ReturnType<typeof apiAs>;
  /** Refunds, but cannot run the cash desk. */
  let accountant: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;
  let plan: PlanDto;

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
  const sell = async (memberId: string, body: object = {}, as = owner): Promise<SaleDto> =>
    (await as.post(`/members/${memberId}/memberships`, { planId: plan.id, ...body }).expect(201))
      .body as SaleDto;
  const memberStatus = async (memberId: string) =>
    ((await owner.get(`/members/${memberId}`).expect(200)).body as MemberDto).status;
  const invoice = async (id: string) =>
    (await owner.get(`/invoices/${id}`).expect(200)).body as InvoiceDto;
  const currentShift = async (location = one) =>
    (
      (await owner.get(`/cash-shifts/current?locationId=${location.id}`).expect(200)).body as {
        shift: CashShiftDto | null;
      }
    ).shift;
  const openShift = async (location = one, openingMinor = '0') =>
    (await owner.post('/cash-shifts/open', { locationId: location.id, openingMinor }).expect(201))
      .body as CashShiftDto;
  const closeOpenShift = async (location = one) => {
    const shift = await currentShift(location);
    if (shift) {
      await owner
        .post(`/cash-shifts/${shift.id}/close`, { countedMinor: shift.totals.expectedMinor })
        .expect(200);
    }
  };
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
    const location = (name: string) =>
      admin.location.create({ data: { organizationId: orgA.id, name, timezone: 'Asia/Tashkent' } });
    one = await location('One');
    two = await location('Two');

    ownerUser = await createStaff(admin, orgA, 'owner');
    const receptionistUser = await createStaff(admin, orgA, 'receptionist');
    const accountantUser = await createStaff(admin, orgA, 'accountant');
    await admin.staffLocation.create({
      data: { organizationId: orgA.id, staffId: receptionistUser.staffId, locationId: one.id },
    });
    owner = apiAs(t, orgA, await cookiesFor(t, orgA, ownerUser));
    receptionist = apiAs(t, orgA, await cookiesFor(t, orgA, receptionistUser));
    accountant = apiAs(t, orgA, await cookiesFor(t, orgA, accountantUser));
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));

    plan = (
      await owner
        .post('/plans', {
          name: 'Monthly',
          type: 'duration',
          durationValue: 1,
          durationUnit: 'month',
          priceMinor: PRICE,
          freeze: { maxDays: 30, maxTimes: 2, minDays: 3, feeMinor: '1000000' },
        })
        .expect(201)
    ).body as PlanDto;
  });

  afterEach(async () => {
    t.clock.reset();
    await closeOpenShift(one);
    await closeOpenShift(two);
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('selling with payment (acceptance criterion 2)', () => {
    it('adds a member, sells and takes cash in one go; the member is active', async () => {
      const shift = await openShift();
      const member = await createMember();
      const sale = await sell(
        member.id,
        { payment: { method: 'cash', amountMinor: PRICE } },
        receptionist,
      );
      expect(sale.membership.status).toBe('active');
      expect(sale.invoice).toMatchObject({
        number: expect.stringMatching(/^\d{4}-\d{6}$/) as string,
        status: 'paid',
        totalMinor: PRICE,
        paidMinor: PRICE,
        balanceMinor: '0',
        currency: 'UZS',
        overdue: false,
        items: [{ kind: 'membership', description: 'Monthly', quantity: 1, totalMinor: PRICE }],
      });
      expect(sale.payment).toMatchObject({
        method: 'cash',
        amountMinor: PRICE,
        refundedMinor: '0',
        cashShiftId: shift.id,
        member: { id: member.id },
        location: { id: one.id },
      });
      await expect(memberStatus(member.id)).resolves.toBe('active');
      await expect(auditOf('payment.create', sale.payment?.id ?? '')).resolves.toHaveLength(1);
      await expect(auditOf('invoice.create', sale.invoice?.id ?? '')).resolves.toHaveLength(1);
    });

    it('refuses cash with no open shift, and the sale is undone', async () => {
      const member = await createMember();
      const response = await owner
        .post(`/members/${member.id}/memberships`, {
          planId: plan.id,
          payment: { method: 'cash', amountMinor: PRICE },
        })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'CASH_SHIFT_NOT_OPEN' });
      const memberships = (await owner.get(`/members/${member.id}/memberships`).expect(200))
        .body as Page<unknown>;
      expect(memberships.items).toEqual([]);
    });

    it('takes card payments without a shift', async () => {
      const sale = await sell((await createMember()).id, {
        payment: { method: 'card_terminal', amountMinor: PRICE, externalId: 'RRN-1' },
      });
      expect(sale.payment).toMatchObject({ cashShiftId: null, externalId: 'RRN-1' });
    });

    it('numbers invoices one after another', async () => {
      const first = await sell((await createMember()).id, { dueOn: '2099-12-31' });
      const second = await sell((await createMember()).id, { dueOn: '2099-12-31' });
      const number = (sale: SaleDto) => Number(sale.invoice?.number.slice(5));
      expect(number(second)).toBe(number(first) + 1);
    });

    it('bills nothing for a free plan', async () => {
      const free = (
        await owner
          .post('/plans', {
            name: 'Trial',
            type: 'trial',
            durationValue: 3,
            durationUnit: 'day',
            priceMinor: '0',
          })
          .expect(201)
      ).body as PlanDto;
      const member = await createMember();
      const sale = await sell(member.id, { planId: free.id });
      expect(sale).toMatchObject({ invoice: null, payment: null });
      await expect(memberStatus(member.id)).resolves.toBe('active');
    });
  });

  describe('partial payments and debt', () => {
    it('owes the rest at once when no due date is given', async () => {
      const member = await createMember();
      const sale = await sell(member.id, {
        payment: { method: 'transfer', amountMinor: '20000000' },
      });
      expect(sale.invoice).toMatchObject({
        status: 'partially_paid',
        paidMinor: '20000000',
        balanceMinor: '25000000',
        overdue: true,
      });
      await expect(memberStatus(member.id)).resolves.toBe('debtor');

      const tooMuch = await owner
        .post(`/invoices/${sale.invoice?.id}/payments`, {
          method: 'transfer',
          amountMinor: '25000001',
        })
        .expect(422);
      expect(tooMuch.body).toMatchObject({
        code: 'AMOUNT_EXCEEDS_BALANCE',
        details: { balanceMinor: '25000000' },
      });

      const paid = (
        await owner
          .post(`/invoices/${sale.invoice?.id}/payments`, {
            method: 'card_terminal',
            amountMinor: '25000000',
          })
          .expect(201)
      ).body as InvoiceDto;
      expect(paid).toMatchObject({ status: 'paid', balanceMinor: '0', overdue: false });
      await expect(memberStatus(member.id)).resolves.toBe('active');

      const again = await owner
        .post(`/invoices/${sale.invoice?.id}/payments`, { method: 'cash', amountMinor: '1' })
        .expect(409);
      expect(again.body).toMatchObject({ code: 'INVOICE_PAID' });
    });

    it('becomes a debtor only after the due date passes', async () => {
      const dueOn = addDays(localDate(new Date(), 'Asia/Tashkent'), 3);
      const member = await createMember();
      const sale = await sell(member.id, { dueOn });
      expect(sale.invoice).toMatchObject({ dueOn, overdue: false });
      await expect(memberStatus(member.id)).resolves.toBe('active');

      // The due day is still a day to pay; from the midnight after it in Tashkent, it is late.
      const late = startOfLocalDay(addDays(dueOn, 1), 'Asia/Tashkent');
      const markOverdueAt = async (now: Date) => {
        t.clock.set(now);
        const handled = await t.app
          .get(TenantDb)
          .run(orgA.id, (tx) => t.app.get(InvoicesService).markOverdue(tx, now));
        t.clock.reset();
        return handled;
      };
      await markOverdueAt(new Date(late.getTime() - 1000));
      await expect(memberStatus(member.id)).resolves.toBe('active');
      await markOverdueAt(late);
      await expect(memberStatus(member.id)).resolves.toBe('debtor');
      await expect(markOverdueAt(new Date(late.getTime() + 3_600_000))).resolves.toBe(0);
    });

    it('refuses a due date in the past', async () => {
      const response = await owner
        .post(`/members/${(await createMember()).id}/memberships`, {
          planId: plan.id,
          dueOn: '2020-01-01',
        })
        .expect(422);
      expect(response.body).toMatchObject({ code: 'INVALID_DUE_DATE' });
    });

    it('is picked up by the hourly job across organizations', async () => {
      // Owed from a minute ago by the real clock.
      t.clock.set(new Date(Date.now() - 2 * 86_400_000));
      const member = await createMember();
      const sale = await sell(member.id, {
        dueOn: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
      });
      t.clock.reset();
      await admin.invoice.update({
        where: { id: sale.invoice?.id },
        data: { dueAt: new Date(Date.now() - 60_000), overdueMarkedAt: null },
      });
      await admin.member.update({ where: { id: member.id }, data: { status: 'active' } });
      await expect(t.app.get(DebtStatusJob).run()).resolves.toBeGreaterThanOrEqual(1);
      await expect(memberStatus(member.id)).resolves.toBe('debtor');
    });

    it('writes off what is owed when the membership is cancelled', async () => {
      const member = await createMember();
      const sale = await sell(member.id);
      await expect(memberStatus(member.id)).resolves.toBe('debtor');
      await owner
        .post(`/memberships/${sale.membership.id}/cancel`, { reason: 'Changed mind' })
        .expect(200);
      await expect(invoice(sale.invoice?.id ?? '')).resolves.toMatchObject({
        status: 'void',
        balanceMinor: '0',
        voidReason: 'Changed mind',
      });
      await expect(memberStatus(member.id)).resolves.toBe('inactive');
    });

    it('voids an invoice by hand only with the refund permission', async () => {
      const member = await createMember();
      const sale = await sell(member.id);
      const id = sale.invoice?.id ?? '';
      await receptionist.post(`/invoices/${id}/void`, { reason: 'Error' }).expect(403);
      await accountant.post(`/invoices/${id}/void`, { reason: 'Entered twice' }).expect(200);
      await expect(memberStatus(member.id)).resolves.toBe('active');
      await expect(auditOf('invoice.void', id)).resolves.toHaveLength(1);
      const again = await owner.post(`/invoices/${id}/void`, { reason: 'X' }).expect(409);
      expect(again.body).toMatchObject({ code: 'INVOICE_VOID' });
    });

    it('bills the freeze fee and takes it with the freeze', async () => {
      const member = await createMember();
      const sale = await sell(member.id, {
        payment: { method: 'card_terminal', amountMinor: PRICE },
      });
      await owner
        .post(`/memberships/${sale.membership.id}/freeze`, {
          startsOn: sale.membership.startsOn,
          days: 3,
          reason: 'Trip',
        })
        .expect(200);
      // Unpaid fee: owed at once.
      await expect(memberStatus(member.id)).resolves.toBe('debtor');
      const invoices = (await owner.get(`/invoices?memberId=${member.id}&status=open`).expect(200))
        .body as Page<InvoiceDto>;
      expect(invoices.items).toEqual([
        expect.objectContaining({
          totalMinor: '1000000',
          items: [expect.objectContaining({ kind: 'freeze_fee' })],
        }),
      ]);
    });

    it('bills other items on a manual invoice', async () => {
      const member = await createMember();
      const created = (
        await owner
          .post('/invoices', {
            memberId: member.id,
            locationId: one.id,
            items: [{ description: 'Towel', quantity: 2, unitMinor: '1500000' }],
            dueOn: '2099-12-31',
          })
          .expect(201)
      ).body as InvoiceDto;
      expect(created).toMatchObject({
        totalMinor: '3000000',
        items: [{ kind: 'other', quantity: 2, unitMinor: '1500000', totalMinor: '3000000' }],
      });
    });
  });

  describe('idempotency', () => {
    it('replays a repeated request instead of taking money twice', async () => {
      const member = await createMember();
      const sale = await sell(member.id, { dueOn: '2099-12-31' });
      const path = `/invoices/${sale.invoice?.id}/payments`;
      const body = { method: 'card_terminal', amountMinor: '1000000' };
      const first = await owner.post(path, body, 'pay-key-0001').expect(201);
      const second = await owner.post(path, body, 'pay-key-0001').expect(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      const payments = await admin.payment.count({ where: { invoiceId: sale.invoice?.id } });
      expect(payments).toBe(1);
    });

    it('refuses the same key with a different request', async () => {
      const sale = await sell((await createMember()).id, { dueOn: '2099-12-31' });
      const path = `/invoices/${sale.invoice?.id}/payments`;
      await owner.post(path, { method: 'card_terminal', amountMinor: '100' }, 'pay-key-0002');
      const response = await owner
        .post(path, { method: 'card_terminal', amountMinor: '200' }, 'pay-key-0002')
        .expect(422);
      expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('requires the key on money endpoints', async () => {
      const member = await createMember();
      const response = await owner
        .postWithoutKey(`/members/${member.id}/memberships`, { planId: plan.id })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    });

    it('lets one of two racing requests run and replays it for the other', async () => {
      const sale = await sell((await createMember()).id, { dueOn: '2099-12-31' });
      const path = `/invoices/${sale.invoice?.id}/payments`;
      const body = { method: 'card_terminal', amountMinor: '500' };
      const [a, b] = await Promise.all([
        owner.post(path, body, 'pay-key-race1'),
        owner.post(path, body, 'pay-key-race1'),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body).toEqual(b.body);
      await expect(admin.payment.count({ where: { invoiceId: sale.invoice?.id } })).resolves.toBe(
        1,
      );
    });

    it('lets a key be used again after its request failed', async () => {
      const sale = await sell((await createMember()).id, { dueOn: '2099-12-31' });
      const path = `/invoices/${sale.invoice?.id}/payments`;
      await owner.post(path, { method: 'cash', amountMinor: '100' }, 'pay-key-fail1').expect(409);
      await openShift();
      await owner.post(path, { method: 'cash', amountMinor: '100' }, 'pay-key-fail1').expect(201);
    });
  });

  describe('refunds (acceptance criterion 9)', () => {
    it('refunds only with the permission, records it and lowers what was paid', async () => {
      const member = await createMember();
      const sale = await sell(member.id, {
        payment: { method: 'card_terminal', amountMinor: PRICE },
      });
      const paymentId = sale.payment?.id ?? '';

      const denied = await receptionist
        .post(`/payments/${paymentId}/refund`, { amountMinor: '1000000', reason: 'X' })
        .expect(403);
      expect(denied.body).toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(admin.refund.count({ where: { paymentId } })).resolves.toBe(0);

      const refund = (
        await accountant
          .post(`/payments/${paymentId}/refund`, { amountMinor: '5000000', reason: 'Discount' })
          .expect(201)
      ).body as RefundDto;
      expect(refund).toMatchObject({ amountMinor: '5000000', method: 'card_terminal' });
      const [entry] = await auditOf('refund.create', paymentId);
      expect(entry).toMatchObject({
        after: { amountMinor: '5000000', reason: 'Discount' },
      });
      await expect(invoice(sale.invoice?.id ?? '')).resolves.toMatchObject({
        status: 'partially_paid',
        paidMinor: '40000000',
      });

      const tooMuch = await accountant
        .post(`/payments/${paymentId}/refund`, { amountMinor: '40000001', reason: 'X' })
        .expect(422);
      expect(tooMuch.body).toMatchObject({
        code: 'REFUND_EXCEEDS_PAYMENT',
        details: { refundableMinor: '40000000' },
      });
      const payment = (await owner.get(`/payments/${paymentId}`).expect(200)).body as PaymentDto;
      expect(payment.refundedMinor).toBe('5000000');
    });

    it('gives cash back only from an open shift', async () => {
      await openShift();
      const sale = await sell((await createMember()).id, {
        payment: { method: 'cash', amountMinor: PRICE },
      });
      await closeOpenShift();
      const response = await owner
        .post(`/payments/${sale.payment?.id}/refund`, { amountMinor: '100', reason: 'X' })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'CASH_SHIFT_NOT_OPEN' });
    });
  });

  describe('cash shifts (acceptance criterion 8)', () => {
    it('closes with a cash report equal to the cash taken less cash given back', async () => {
      const shift = await openShift(one, '10000000');
      const conflict = await owner
        .post('/cash-shifts/open', { locationId: one.id, openingMinor: '0' })
        .expect(409);
      expect(conflict.body).toMatchObject({ code: 'CASH_SHIFT_ALREADY_OPEN' });

      const cash1 = await sell((await createMember()).id, {
        payment: { method: 'cash', amountMinor: PRICE },
      });
      const part = await sell((await createMember()).id, {
        payment: { method: 'cash', amountMinor: '20000000' },
        dueOn: '2099-12-31',
      });
      await owner
        .post(`/invoices/${part.invoice?.id}/payments`, { method: 'cash', amountMinor: '5000000' })
        .expect(201);
      await sell((await createMember()).id, {
        payment: { method: 'card_terminal', amountMinor: PRICE },
      });
      await owner
        .post(`/payments/${cash1.payment?.id}/refund`, { amountMinor: '3000000', reason: 'X' })
        .expect(201);

      const running = await currentShift();
      expect(running?.totals).toEqual({
        cashInMinor: '70000000',
        cashRefundsMinor: '3000000',
        expectedMinor: '77000000',
        cardTerminalMinor: PRICE,
        transferMinor: '0',
        paymentsCount: 4,
      });

      // The report matches the payments journal of the shift.
      const journal = (
        await owner.get(`/payments?cashShiftId=${shift.id}&method=cash&limit=100`).expect(200)
      ).body as Page<PaymentDto>;
      const cashTaken = journal.items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
      expect(cashTaken.toString()).toBe(running?.totals.cashInMinor);

      const closed = (
        await owner
          .post(`/cash-shifts/${shift.id}/close`, { countedMinor: '76500000', note: 'Short' })
          .expect(200)
      ).body as CashShiftDto;
      expect(closed).toMatchObject({
        status: 'closed',
        countedMinor: '76500000',
        differenceMinor: '-500000',
        note: 'Short',
        totals: { expectedMinor: '77000000' },
      });
      await expect(auditOf('cash_shift.close', shift.id)).resolves.toEqual([
        expect.objectContaining({
          after: {
            expectedMinor: '77000000',
            countedMinor: '76500000',
            differenceMinor: '-500000',
          },
        }),
      ]);

      const again = await owner
        .post(`/cash-shifts/${shift.id}/close`, { countedMinor: '0' })
        .expect(409);
      expect(again.body).toMatchObject({ code: 'CASH_SHIFT_CLOSED' });
      await expect(currentShift()).resolves.toBeNull();
    });

    it('lets staff run the desk only at their own locations', async () => {
      const denied = await receptionist
        .post('/cash-shifts/open', { locationId: two.id, openingMinor: '0' })
        .expect(403);
      expect(denied.body).toMatchObject({ code: 'LOCATION_NOT_ASSIGNED' });
      await receptionist
        .post('/cash-shifts/open', { locationId: one.id, openingMinor: '0' })
        .expect(201);
      await accountant.get(`/cash-shifts/current?locationId=${one.id}`).expect(403);
    });
  });

  describe('journal and receipts', () => {
    it('shows each staff member the payments of their locations', async () => {
      const atTwo = await sell((await createMember(two)).id, {
        payment: { method: 'card_terminal', amountMinor: PRICE },
      });
      const all = (await owner.get('/payments?limit=100').expect(200)).body as Page<PaymentDto>;
      expect(all.items.map((item) => item.id)).toContain(atTwo.payment?.id);
      const mine = (await receptionist.get('/payments?limit=100').expect(200))
        .body as Page<PaymentDto>;
      expect(mine.items.map((item) => item.id)).not.toContain(atTwo.payment?.id);
      await receptionist.get(`/payments/${atTwo.payment?.id}`).expect(404);
    });

    it('filters the journal by member and time', async () => {
      const member = await createMember();
      const sale = await sell(member.id, {
        payment: { method: 'card_terminal', amountMinor: PRICE },
      });
      const byMember = (await owner.get(`/payments?memberId=${member.id}`).expect(200))
        .body as Page<PaymentDto>;
      expect(byMember.items.map((item) => item.id)).toEqual([sale.payment?.id]);
      const future = (
        await owner.get(`/payments?memberId=${member.id}&from=2099-01-01T00:00:00Z`).expect(200)
      ).body as Page<PaymentDto>;
      expect(future.items).toEqual([]);
    });

    it('prints a receipt and texts it on request', async () => {
      const member = await createMember();
      const sale = await sell(member.id, {
        payment: { method: 'card_terminal', amountMinor: '40000000' },
        dueOn: '2099-12-31',
      });
      const receipt = (await owner.get(`/payments/${sale.payment?.id}/receipt`).expect(200))
        .body as ReceiptDto;
      expect(receipt).toMatchObject({
        organization: { name: 'A' },
        location: { name: 'One' },
        invoiceNumber: sale.invoice?.number,
        method: 'card_terminal',
        amountMinor: '40000000',
        invoiceTotalMinor: PRICE,
        balanceMinor: '5000000',
        member: { phone: member.phone },
        items: [{ description: 'Monthly', quantity: 1, totalMinor: PRICE }],
      });
      expect(t.sms.sent.filter((sms) => sms.to === member.phone)).toEqual([]);
      await owner.post(`/payments/${sale.payment?.id}/receipt/sms`).expect(204);
      const [sms] = t.sms.sent.filter((item) => item.to === member.phone);
      expect(sms?.text).toContain(sale.invoice?.number);
    });
  });

  describe('organization isolation (acceptance criterion 10)', () => {
    it('B sees and changes none of A’s money', async () => {
      const shift = await openShift();
      const sale = await sell((await createMember()).id, {
        payment: { method: 'cash', amountMinor: '10000000' },
        dueOn: '2099-12-31',
      });
      await ownerB.get(`/invoices/${sale.invoice?.id}`).expect(404);
      await ownerB
        .post(`/invoices/${sale.invoice?.id}/payments`, {
          method: 'card_terminal',
          amountMinor: '1',
        })
        .expect(404);
      await ownerB.get(`/payments/${sale.payment?.id}`).expect(404);
      await ownerB
        .post(`/payments/${sale.payment?.id}/refund`, { amountMinor: '1', reason: 'X' })
        .expect(404);
      await ownerB.get(`/cash-shifts/${shift.id}`).expect(404);
      const journal = (await ownerB.get('/payments?limit=100').expect(200)).body as Page<unknown>;
      expect(journal.items).toEqual([]);

      const seen = await t.app.get(TenantDb).run(orgB.id, async (tx) => ({
        invoices: await tx.invoice.count({ where: { organizationId: orgA.id } }),
        items: await tx.invoiceItem.count({ where: { organizationId: orgA.id } }),
        payments: await tx.payment.count({ where: { organizationId: orgA.id } }),
        refunds: await tx.refund.count({ where: { organizationId: orgA.id } }),
        shifts: await tx.cashShift.count({ where: { organizationId: orgA.id } }),
        keys: await tx.idempotencyKey.count({ where: { organizationId: orgA.id } }),
      }));
      expect(seen).toEqual({ invoices: 0, items: 0, payments: 0, refunds: 0, shifts: 0, keys: 0 });
    });

    it('never changes or deletes a payment, even inside the organization', async () => {
      const sale = await sell((await createMember()).id, {
        payment: { method: 'card_terminal', amountMinor: PRICE },
      });
      const id = sale.payment?.id ?? '';
      await expect(
        t.app
          .get(TenantDb)
          .run(orgA.id, (tx) => tx.payment.update({ where: { id }, data: { amountMinor: 1n } })),
      ).rejects.toThrow();
      await expect(
        t.app.get(TenantDb).run(orgA.id, (tx) => tx.payment.delete({ where: { id } })),
      ).rejects.toThrow();
    });
  });
});
