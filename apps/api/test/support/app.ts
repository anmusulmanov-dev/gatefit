import { randomUUID } from 'node:crypto';
import { type Permission, SYSTEM_ROLE_PERMISSIONS, type SystemRole } from '@gatefit/shared';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { Clock } from '../../src/common/clock/clock';
import { SMS_PROVIDER, type SmsProvider } from '../../src/common/sms/sms.provider';
import { TenantDb } from '../../src/common/tenancy/tenant-db.service';
import { SessionService } from '../../src/modules/auth/session.service';
import type { Organization, PrismaClient } from '../../src/generated/prisma/client';
import { PasswordService } from '../../src/common/security/password.service';
import { uniquePhone } from './db';

/** A clock tests can move forward. */
export class TestClock extends Clock {
  private offsetMs = 0;

  override now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  advance(seconds: number): void {
    this.offsetMs += seconds * 1000;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}

/** Captures SMS instead of sending them. */
export class FakeSms implements SmsProvider {
  readonly sent: { to: string; text: string }[] = [];

  send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
    return Promise.resolve();
  }

  /** The six-digit code from the latest message to this phone. */
  lastCode(phone: string): string {
    const message = this.sent.findLast((sms) => sms.to === phone);
    const code = message?.text.match(/\d{6}/)?.[0];
    if (!code) {
      throw new Error(`No SMS code was sent to ${phone}`);
    }
    return code;
  }
}

export interface TestApp {
  app: NestExpressApplication;
  clock: TestClock;
  sms: FakeSms;
}

/** The real application, configured like production, with time and SMS under test control. */
export async function createTestApp(
  extraImports: NonNullable<ModuleMetadata['imports']> = [],
): Promise<TestApp> {
  const clock = new TestClock();
  const sms = new FakeSms();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...extraImports] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, clock, sms };
}

/** The Host header that addresses an organization. */
export function hostOf(organization: Pick<Organization, 'slug'>): string {
  return `${organization.slug}.localhost`;
}

/** `name=value` pairs from Set-Cookie, ready to send back in a Cookie header. */
export function cookiesFrom(response: Response): string[] {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return list.map((cookie) => cookie.split(';')[0] ?? '').filter((pair) => !pair.endsWith('='));
}

const passwords = new PasswordService();

export interface StaffFixture {
  userId: string;
  staffId: string;
  roleId: string;
  phone: string;
  password: string;
}

/** Creates a user, a standard role with its permissions, and an active staff record. */
export async function createStaff(
  admin: PrismaClient,
  organization: Organization,
  roleName: SystemRole,
): Promise<StaffFixture> {
  const organizationId = organization.id;
  const phone = uniquePhone();
  const password = `pw-${randomUUID()}`;

  let role = await admin.role.findUnique({
    where: { organizationId_name: { organizationId, name: roleName } },
  });
  if (!role) {
    role = await admin.role.create({ data: { organizationId, name: roleName, isSystem: true } });
    await admin.rolePermission.createMany({
      data: SYSTEM_ROLE_PERMISSIONS[roleName].map((permission) => ({
        organizationId,
        roleId: (role as { id: string }).id,
        permission,
      })),
    });
  }
  const user = await admin.user.create({ data: { phone } });
  const staff = await admin.staff.create({
    data: {
      organizationId,
      userId: user.id,
      roleId: role.id,
      firstName: 'Test',
      lastName: roleName,
      passwordHash: await passwords.hash(password),
    },
  });

  return { userId: user.id, staffId: staff.id, roleId: role.id, phone, password };
}

/** A staff member holding a custom role with exactly the given permissions. */
export async function createStaffWithPermissions(
  admin: PrismaClient,
  organization: Organization,
  roleName: string,
  permissions: Permission[],
): Promise<StaffFixture> {
  const organizationId = organization.id;
  const phone = uniquePhone();
  const password = `pw-${randomUUID()}`;

  const role = await admin.role.create({ data: { organizationId, name: roleName } });
  await admin.rolePermission.createMany({
    data: permissions.map((permission) => ({ organizationId, roleId: role.id, permission })),
  });
  const user = await admin.user.create({ data: { phone } });
  const staff = await admin.staff.create({
    data: {
      organizationId,
      userId: user.id,
      roleId: role.id,
      firstName: 'Test',
      lastName: roleName,
      passwordHash: await passwords.hash(password),
    },
  });
  return { userId: user.id, staffId: staff.id, roleId: role.id, phone, password };
}

/**
 * Session cookies for a staff member, issued directly. For tests of what a signed-in
 * user may do; sign-in itself (passwords, TOTP) has its own tests.
 */
export async function cookiesFor(
  t: TestApp,
  organization: Organization,
  staff: Pick<StaffFixture, 'userId'>,
): Promise<string[]> {
  const tokens = await t.app
    .get(TenantDb)
    .run(organization.id, (tx) =>
      t.app
        .get(SessionService)
        .issue(
          tx,
          organization.id,
          { userId: staff.userId, audience: 'staff' },
          { ip: undefined, userAgent: 'test' },
        ),
    );
  return [`gf_staff_access=${tokens.accessToken}`, `gf_staff_refresh=${tokens.refreshToken}`];
}

/** Requests to the API at an organization's address as the holder of the given cookies. */
export function apiAs(t: TestApp, organization: Organization, cookies: string[]) {
  const send = (method: 'get' | 'post' | 'patch', path: string) =>
    request(t.app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Host', hostOf(organization))
      .set('Cookie', cookies);
  return {
    get: (path: string) => send('get', path),
    post: (path: string, body?: object) => send('post', path).send(body),
    patch: (path: string, body: object) => send('patch', path).send(body),
  };
}
