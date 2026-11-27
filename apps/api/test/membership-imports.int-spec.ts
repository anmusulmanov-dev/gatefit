import {
  addDays,
  localDate,
  type MemberDto,
  type MembershipDto,
  type MembershipImportDto,
  type Page,
  type PlanDto,
} from '@gatefit/shared';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import {
  apiAs,
  cookiesFor,
  createPlan,
  createStaff,
  createTestApp,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniqueMobile } from './support/db';

const NL = String.fromCharCode(10);
const csv = (rows: string[][]) => Buffer.from(rows.map((row) => row.join(',')).join(NL));
/** A national number as people type it: 9 digits, no country code. */
const national = (phone: string) => phone.slice(-9);
const dotted = (date: string) => date.split('-').reverse().join('.');

describe('Membership imports (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let two: Location;
  let owner: ReturnType<typeof apiAs>;
  let manager: ReturnType<typeof apiAs>;
  let receptionist: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;
  let monthly: PlanDto;
  let tenVisits: PlanDto;
  let today: string;

  const header = [
    'Telefon',
    'Tarif',
    'Boshlanish sanasi',
    'Tugash sanasi',
    'Qolgan tashriflar',
    'Qarz',
  ];

  const createMember = async (location = one): Promise<MemberDto> =>
    (
      await owner
        .post('/members', {
          firstName: 'Aziz',
          lastName: 'Karimov',
          phone: uniqueMobile(),
          homeLocationId: location.id,
        })
        .expect(201)
    ).body as MemberDto;

  const membershipsOf = async (memberId: string): Promise<MembershipDto[]> =>
    ((await owner.get(`/members/${memberId}/memberships`).expect(200)).body as Page<MembershipDto>)
      .items;

  async function finished(id: string, as = owner): Promise<MembershipImportDto> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = (await as.get(`/membership-imports/${id}`).expect(200))
        .body as MembershipImportDto;
      if (current.status === 'done' || current.status === 'failed') {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The import did not finish');
  }

  async function uploadAndCheck(rows: string[][], as = owner): Promise<MembershipImportDto> {
    const uploaded = (
      await as.upload('post', '/membership-imports', csv(rows), 'memberships.csv').expect(201)
    ).body as MembershipImportDto;
    return (
      await as
        .post(`/membership-imports/${uploaded.id}/validate`, { mapping: uploaded.mapping })
        .expect(200)
    ).body as MembershipImportDto;
  }

  async function run(rows: string[][], as = owner): Promise<MembershipImportDto> {
    const checked = await uploadAndCheck(rows, as);
    await as.post(`/membership-imports/${checked.id}/commit`).expect(202);
    return finished(checked.id, as);
  }

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
    const location = (organization: Organization, name: string) =>
      admin.location.create({
        data: { organizationId: organization.id, name, timezone: 'Asia/Tashkent' },
      });
    one = await location(orgA, 'Chilonzor');
    two = await location(orgA, 'Yunusobod');
    await location(orgB, 'Other');

    owner = apiAs(t, orgA, await cookiesFor(t, orgA, await createStaff(admin, orgA, 'owner')));
    const managerUser = await createStaff(admin, orgA, 'manager');
    await admin.staffLocation.create({
      data: { organizationId: orgA.id, staffId: managerUser.staffId, locationId: one.id },
    });
    manager = apiAs(t, orgA, await cookiesFor(t, orgA, managerUser));
    const receptionistUser = await createStaff(admin, orgA, 'receptionist');
    await admin.staffLocation.create({
      data: { organizationId: orgA.id, staffId: receptionistUser.staffId, locationId: one.id },
    });
    receptionist = apiAs(t, orgA, await cookiesFor(t, orgA, receptionistUser));
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));

    const plan = async (body: object): Promise<PlanDto> =>
      (
        await owner
          .post('/plans', {
            type: 'duration',
            durationValue: 1,
            durationUnit: 'month',
            priceMinor: '45000000',
            ...body,
          })
          .expect(201)
      ).body as PlanDto;
    monthly = await plan({ name: 'Oylik' });
    tenVisits = await plan({ name: "10 ta mashg'ulot", type: 'visits', visitLimit: 10 });
    today = localDate(t.clock.now(), 'Asia/Tashkent');
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  it('brings in running memberships with their own dates, visits and debt, and no revenue', async () => {
    const paidUp = await createMember();
    const owing = await createMember(two);
    const startsOn = addDays(today, -60);
    const endsOn = addDays(today, 30);

    const done = await run([
      header,
      [national(paidUp.phone), 'oylik', dotted(startsOn), dotted(endsOn), '', ''],
      [paidUp.phone, tenVisits.name, addDays(today, 31), addDays(today, 61), '4', ''],
      [owing.phone, '  OYLIK ', startsOn, endsOn, '', '150 000'],
    ]);
    expect(done).toMatchObject({ status: 'done', createdCount: 3, skippedCount: 0, errorCount: 0 });
    expect(done.debtMinor).toBe('15000000');

    const [later, current] = await membershipsOf(paidUp.id);
    expect(current).toMatchObject({
      plan: { id: monthly.id },
      status: 'active',
      startsOn,
      endsOn,
      location: { id: one.id },
      importId: done.id,
    });
    expect(later).toMatchObject({ status: 'scheduled', visitsLeft: 4, visitLimit: 10 });

    const [owed] = await membershipsOf(owing.id);
    expect(owed).toMatchObject({ location: { id: two.id }, status: 'active' });
    const member = (await owner.get(`/members/${owing.id}`).expect(200)).body as MemberDto;
    expect(member.status).toBe('debtor');
    const invoices = await admin.invoice.findMany({ where: { memberId: owing.id } });
    expect(invoices).toEqual([
      expect.objectContaining({ totalMinor: 15000000n, paidMinor: 0n, status: 'open' }),
    ]);
    // Nothing was paid or sold: no payments at all.
    await expect(
      admin.payment.count({ where: { memberId: { in: [paidUp.id, owing.id] } } }),
    ).resolves.toBe(0);
    expect((await owner.get(`/members/${paidUp.id}`).expect(200)).body as MemberDto).toMatchObject({
      status: 'active',
    });

    const audit = await admin.auditLog.findMany({
      where: { organizationId: orgA.id, action: 'membership.import' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it('lists what is wrong with each row and writes only the valid ones', async () => {
    const member = await createMember();
    const sold = await createMember();
    await owner
      .post(`/members/${sold.id}/memberships`, { planId: monthly.id, dueOn: addDays(today, 10) })
      .expect(201);
    const checked = await uploadAndCheck([
      [...header, 'Filial'],
      ['', 'Oylik', today, addDays(today, 5), '', '', ''],
      ['12', 'Oylik', today, addDays(today, 5), '', '', ''],
      [uniqueMobile(), 'Oylik', today, addDays(today, 5), '', '', ''],
      [member.phone, 'Yillik', today, addDays(today, 5), '', '', ''],
      [member.phone, 'Oylik', '31.02.2026', addDays(today, 5), '', '', ''],
      [member.phone, 'Oylik', today, addDays(today, -5), '', '', ''],
      [member.phone, 'Oylik', addDays(today, -40), addDays(today, -1), '', '', ''],
      [member.phone, 'Oylik', today, addDays(today, 5), '3', '', ''],
      [member.phone, tenVisits.name, today, addDays(today, 5), '', '', ''],
      [member.phone, tenVisits.name, today, addDays(today, 5), '11', '', ''],
      [member.phone, 'Oylik', today, addDays(today, 5), '', "ko'p", ''],
      [member.phone, 'Oylik', today, addDays(today, 5), '', '', 'Sergeli'],
      [sold.phone, 'Oylik', today, addDays(today, 5), '', '', ''],
      [member.phone, 'Oylik', today, addDays(today, 5), '', '', 'yunusobod'],
      [member.phone, 'Oylik', addDays(today, 3), addDays(today, 9), '', '', ''],
    ]);
    expect(checked).toMatchObject({ status: 'validated', totalRows: 15, validRows: 1 });
    expect(checked.errors.map((error) => [error.row, error.code])).toEqual([
      [2, 'PHONE_REQUIRED'],
      [3, 'PHONE_INVALID'],
      [4, 'MEMBER_NOT_FOUND'],
      [5, 'PLAN_NOT_FOUND'],
      [6, 'DATE_INVALID'],
      [7, 'END_BEFORE_START'],
      [8, 'ALREADY_ENDED'],
      [9, 'VISITS_NOT_APPLICABLE'],
      [10, 'VISITS_REQUIRED'],
      [11, 'VISITS_INVALID'],
      [12, 'DEBT_INVALID'],
      [13, 'LOCATION_NOT_FOUND'],
      [14, 'OVERLAP'],
      // Row 15 is valid; row 16 overlaps it.
      [16, 'OVERLAP'],
    ]);

    await owner.post(`/membership-imports/${checked.id}/commit`).expect(202);
    const done = await finished(checked.id);
    expect(done.createdCount).toBe(1);
    const [only] = await membershipsOf(member.id);
    expect(only).toMatchObject({ location: { id: two.id }, importId: checked.id });
    // Committing again changes nothing.
    await owner.post(`/membership-imports/${checked.id}/commit`).expect(202);
    await expect(membershipsOf(member.id)).resolves.toHaveLength(1);
  });

  it('undoes an import while nobody has used or paid for its memberships', async () => {
    const first = await createMember();
    const second = await createMember();
    const done = await run([
      header,
      [first.phone, 'Oylik', today, addDays(today, 20), '', '100000'],
      [second.phone, 'Oylik', today, addDays(today, 20), '', ''],
    ]);
    await expect(
      owner.post(`/membership-imports/${done.id}/revert`, {}).expect(400),
    ).resolves.toBeDefined();
    const reverted = (
      await owner
        .post(`/membership-imports/${done.id}/revert`, { reason: 'Wrong file' })
        .expect(202)
    ).body as MembershipImportDto;
    expect(reverted.revertedAt).not.toBeNull();

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const left = await admin.membership.count({
        where: { importId: done.id, cancelledAt: null },
      });
      if (left === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const [cancelled] = await membershipsOf(first.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong file' });
    const invoices = await admin.invoice.findMany({ where: { memberId: first.id } });
    expect(invoices.map((invoice) => invoice.status)).toEqual(['void']);
    expect(
      ((await owner.get(`/members/${first.id}`).expect(200)).body as MemberDto).status,
    ).not.toBe('debtor');
    // Asking again changes nothing.
    await owner.post(`/membership-imports/${done.id}/revert`, { reason: 'Again' }).expect(202);
  });

  it('refuses to undo once a member has come in or paid', async () => {
    const visitor = await createMember();
    const visited = await run([
      header,
      [visitor.phone, 'Oylik', today, addDays(today, 20), '', ''],
    ]);
    await receptionist
      .post('/access/manual', { memberId: visitor.id, locationId: one.id, reason: 'Card at home' })
      .expect(200);
    const blocked = await owner
      .post(`/membership-imports/${visited.id}/revert`, { reason: 'Wrong file' })
      .expect(409);
    expect(blocked.body).toMatchObject({
      code: 'IMPORT_REVERT_BLOCKED',
      details: { reason: 'entries' },
    });

    const payer = await createMember();
    const paid = await run([
      header,
      [payer.phone, 'Oylik', today, addDays(today, 20), '', '50000'],
    ]);
    const [invoice] = await admin.invoice.findMany({ where: { memberId: payer.id } });
    await owner
      .post(`/invoices/${invoice?.id ?? ''}/payments`, { method: 'transfer', amountMinor: '100' })
      .expect(201);
    const refused = await owner
      .post(`/membership-imports/${paid.id}/revert`, { reason: 'Wrong file' })
      .expect(409);
    expect(refused.body).toMatchObject({ details: { reason: 'payments' } });

    const unfinished = await uploadAndCheck([header]);
    const early = await owner
      .post(`/membership-imports/${unfinished.id}/revert`, { reason: 'x' })
      .expect(409);
    expect(early.body).toMatchObject({ code: 'IMPORT_NOT_FINISHED' });
  });

  it('keeps location-bound staff to their locations and their own uploads', async () => {
    const atOne = await createMember(one);
    const atTwo = await createMember(two);
    const checked = await uploadAndCheck(
      [
        [...header, 'Filial'],
        [atOne.phone, 'Oylik', today, addDays(today, 20), '', '', ''],
        // Not visible to a manager of Chilonzor.
        [atTwo.phone, 'Oylik', today, addDays(today, 20), '', '', ''],
        [atOne.phone, 'Oylik', addDays(today, 40), addDays(today, 60), '', '', 'Yunusobod'],
      ],
      manager,
    );
    expect(checked.errors.map((error) => [error.row, error.code])).toEqual([
      [3, 'MEMBER_NOT_FOUND'],
      [4, 'LOCATION_NOT_ASSIGNED'],
    ]);
    await owner.get(`/membership-imports/${checked.id}`).expect(200);
    const ownUpload = await uploadAndCheck([header]);
    await manager.get(`/membership-imports/${ownUpload.id}`).expect(404);
    const listed = (await manager.get('/membership-imports').expect(200))
      .body as Page<MembershipImportDto>;
    expect(listed.items.map((item) => item.id)).toEqual([checked.id]);

    // Reception may not import memberships.
    await receptionist.upload('post', '/membership-imports', csv([header]), 'm.csv').expect(403);
  });

  it('keeps imports and their memberships to their organization', async () => {
    const member = await createMember();
    const done = await run([header, [member.phone, 'Oylik', today, addDays(today, 20), '', '']]);
    await ownerB.get(`/membership-imports/${done.id}`).expect(404);
    await ownerB.post(`/membership-imports/${done.id}/commit`).expect(404);
    await ownerB.post(`/membership-imports/${done.id}/revert`, { reason: 'x' }).expect(404);
    const listed = (await ownerB.get('/membership-imports').expect(200))
      .body as Page<MembershipImportDto>;
    expect(listed.items).toEqual([]);

    // A phone of organization A means nothing in organization B.
    const elsewhere = await uploadAndCheck(
      [header, [member.phone, 'Oylik', today, addDays(today, 20), '', '']],
      ownerB,
    );
    // Nor does a plan name: organization B has no such plan.
    expect(elsewhere.errors.map((error) => error.code)).toEqual([
      'MEMBER_NOT_FOUND',
      'PLAN_NOT_FOUND',
    ]);

    // Row-level security: organization B sees none of A's import rows.
    const seenByB = await t.app
      .get(TenantDb)
      .run(orgB.id, (tx) => tx.membershipImport.count({ where: { id: done.id } }));
    expect(seenByB).toBe(0);
  });

  it('serves a template with the columns it understands', async () => {
    const response = await owner.get('/membership-imports/template').expect(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');
  });
});
