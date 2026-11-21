import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PLAN_MODULES,
  type DefaultPlanKey,
  type Permission,
  SYSTEM_ROLE_PERMISSIONS,
  type SystemRole,
} from '@gatefit/shared';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { Clock } from '../../src/common/clock/clock';
import { QUEUE_PREFIX } from '../../src/common/queue/queue.service';
import { SMS_PROVIDER, type SmsProvider } from '../../src/common/sms/sms.provider';
import { FILE_STORAGE, MemoryFileStorage } from '../../src/common/storage/file-storage';
import { TenantDb } from '../../src/common/tenancy/tenant-db.service';
import { SessionService } from '../../src/modules/auth/session.service';
import { PlatformSessionService } from '../../src/modules/platform/platform-session.service';
import type { Organization, PrismaClient, SaasPlan } from '../../src/generated/prisma/client';
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

  /** Makes it `instant` now; time keeps running from there. */
  set(instant: Date | string): void {
    this.offsetMs = new Date(instant).getTime() - Date.now();
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
  storage: MemoryFileStorage;
}

/** The real application, configured like production, with time and SMS under test control. */
export async function createTestApp(
  extraImports: NonNullable<ModuleMetadata['imports']> = [],
): Promise<TestApp> {
  const clock = new TestClock();
  const sms = new FakeSms();
  const storage = new MemoryFileStorage();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...extraImports] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .overrideProvider(FILE_STORAGE)
    .useValue(storage)
    // Test files run in parallel; each app's workers must see only its own jobs.
    .overrideProvider(QUEUE_PREFIX)
    .useValue(`gatefit-test-${randomUUID()}`)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, clock, sms, storage };
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
  const send = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
    request(t.app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Host', hostOf(organization))
      .set('Cookie', cookies);
  return {
    get: (path: string) => send('get', path),
    post: (path: string, body?: object) => send('post', path).send(body),
    patch: (path: string, body: object) => send('patch', path).send(body),
    put: (path: string, body: object) => send('put', path).send(body),
    delete: (path: string) => send('delete', path),
    /** A multipart upload of one file in the field "file". */
    upload: (method: 'post' | 'put', path: string, content: Buffer, fileName: string) =>
      send(method, path).attach('file', content, fileName),
  };
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/** The Host header of Gatefit's back office. */
export const PLATFORM_HOST = 'admin.localhost';

const PLAN_LIMITS: Record<DefaultPlanKey, number | null> = {
  start: 200,
  standard: 1000,
  pro: null,
};

/** A plan modelled on one of the standard tariffs, under a key unique to this test. */
export function createPlan(admin: PrismaClient, template: DefaultPlanKey): Promise<SaasPlan> {
  return admin.saasPlan.create({
    data: {
      key: `${template}_${randomUUID().slice(0, 8)}`,
      name: template,
      limits: { activeMembersPerLocation: PLAN_LIMITS[template] },
      modules: DEFAULT_PLAN_MODULES[template],
      priceMinor: 30_000_000n,
      currency: 'UZS',
    },
  });
}

export interface PlatformAdminFixture {
  id: string;
  phone: string;
  password: string;
}

export async function createPlatformAdmin(admin: PrismaClient): Promise<PlatformAdminFixture> {
  const phone = uniquePhone();
  const password = `pw-${randomUUID()}`;
  const created = await admin.platformAdmin.create({
    data: { phone, name: 'Test Operator', passwordHash: await passwords.hash(password) },
  });
  return { id: created.id, phone, password };
}

/** Requests to the platform API as a signed-in operator (or as nobody, with no fixture). */
export async function platformApi(t: TestApp, operator?: PlatformAdminFixture) {
  const cookies = operator
    ? [
        `gf_platform_session=${await t.app
          .get(PlatformSessionService)
          .start(operator.id, { ip: undefined, userAgent: 'test' })}`,
      ]
    : [];
  const send = (method: 'get' | 'post' | 'patch', path: string) =>
    request(t.app.getHttpServer())
      [method](`/api/v1/platform${path}`)
      .set('Host', PLATFORM_HOST)
      .set('Cookie', cookies);
  return {
    get: (path: string) => send('get', path),
    post: (path: string, body?: object) => send('post', path).send(body),
    patch: (path: string, body: object) => send('patch', path).send(body),
  };
}
