import { Controller, Get, Module } from '@nestjs/common';
import request from 'supertest';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import { AnyAuthenticated, RequirePermission } from '../src/modules/auth/auth.decorators';
import {
  cookiesFrom,
  createStaff,
  createTestApp,
  hostOf,
  type StaffFixture,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, memberPhone } from './support/db';

// No business endpoint exists yet, so the rules are exercised on stand-ins.
@Controller('probe')
class ProbeController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get('locations')
  @RequirePermission('locations.read')
  async locations(): Promise<string[]> {
    const rows = await this.tenantDb.tx.location.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => row.name);
  }

  @Get('members')
  @RequirePermission('members.manage')
  members(): { ok: true } {
    return { ok: true };
  }

  @Get('refund')
  @RequirePermission('payments.read', 'payments.refund')
  refund(): { ok: true } {
    return { ok: true };
  }

  @Get('self')
  @AnyAuthenticated()
  self(): { ok: true } {
    return { ok: true };
  }

  // Deliberately carries no marker.
  @Get('forgotten')
  forgotten(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('Permissions (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let org: Organization;
  let manager: StaffFixture;
  let trainer: StaffFixture;
  let accountant: StaffFixture;

  const http = () => request(t.app.getHttpServer());
  const signIn = async (staff: StaffFixture): Promise<string[]> =>
    cookiesFrom(
      await http()
        .post('/api/v1/auth/login')
        .set('Host', hostOf(org))
        .send({ phone: staff.phone, password: staff.password })
        .expect(204),
    );
  const get = (path: string, cookies: string[]) =>
    http().get(`/api/v1/probe/${path}`).set('Host', hostOf(org)).set('Cookie', cookies);

  beforeAll(async () => {
    t = await createTestApp([ProbeModule]);
    admin = createAdminClient();
    org = await createOrganization(admin, 'A');
    manager = await createStaff(admin, org, 'manager');
    trainer = await createStaff(admin, org, 'trainer');
    accountant = await createStaff(admin, org, 'accountant');
    // The accountant role requires TOTP at sign-in; that flow has its own tests.
    await admin.role.update({ where: { id: accountant.roleId }, data: { isSystem: false } });
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  // The exit criterion of stage 0, end to end: sign in over HTTP, read through RLS.
  it('two organizations cannot see data of one another', async () => {
    const other = await createOrganization(admin, 'B');
    const otherManager = await createStaff(admin, other, 'manager');
    await admin.location.createMany({
      data: [
        { organizationId: org.id, name: 'A one', timezone: 'Asia/Tashkent' },
        { organizationId: org.id, name: 'A two', timezone: 'Asia/Tashkent' },
        { organizationId: other.id, name: 'B one', timezone: 'Asia/Tashkent' },
      ],
    });

    const cookiesA = await signIn(manager);
    const cookiesB = cookiesFrom(
      await http()
        .post('/api/v1/auth/login')
        .set('Host', hostOf(other))
        .send({ phone: otherManager.phone, password: otherManager.password })
        .expect(204),
    );
    const locations = (host: Organization, cookies: string[]) =>
      http().get('/api/v1/probe/locations').set('Host', hostOf(host)).set('Cookie', cookies);

    await locations(org, cookiesA).expect(200, ['A one', 'A two']);
    await locations(other, cookiesB).expect(200, ['B one']);
    // A session of one organization opens nothing at the other's address.
    await locations(other, cookiesA).expect(401);
    await locations(org, cookiesB).expect(401);
  });

  it('answers 401 without a session', async () => {
    const response = await get('members', []).expect(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('lets through a role that holds the permission', async () => {
    await get('members', await signIn(manager)).expect(200, { ok: true });
  });

  it('answers 403 for a role that lacks it', async () => {
    const response = await get('members', await signIn(trainer)).expect(403);
    expect(response.body).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'Permission denied',
      details: null,
    });
  });

  it('requires every listed permission', async () => {
    // The manager reads payments but may not refund; the accountant may do both.
    await get('refund', await signIn(manager)).expect(403);
    await get('refund', await signIn(accountant)).expect(200);
  });

  it('applies a permission change on the very next request', async () => {
    const receptionist = await createStaff(admin, org, 'receptionist');
    const cookies = await signIn(receptionist);
    await get('members', cookies).expect(200);

    await admin.rolePermission.delete({
      where: {
        roleId_permission: { roleId: receptionist.roleId, permission: 'members.manage' },
      },
    });
    await get('members', cookies).expect(403);
  });

  it('never grants staff permissions to a member session', async () => {
    const phone = await memberPhone(admin, org);
    await http().post('/api/v1/auth/otp/request').set('Host', hostOf(org)).send({ phone });
    const cookies = cookiesFrom(
      await http()
        .post('/api/v1/auth/otp/verify')
        .set('Host', hostOf(org))
        .send({ phone, code: t.sms.lastCode(phone) }),
    );

    const asMember = (path: string) => get(path, cookies).set('x-gatefit-client', 'member');
    await asMember('members').expect(403);
    await asMember('self').expect(200);
  });

  it('opens @AnyAuthenticated endpoints to any signed-in user', async () => {
    await get('self', await signIn(trainer)).expect(200);
    await get('self', []).expect(401);
  });

  it('refuses an endpoint that declares no access rule, even for a signed-in user', async () => {
    await get('forgotten', await signIn(manager)).expect(403);
    await get('forgotten', []).expect(401);
  });
});
