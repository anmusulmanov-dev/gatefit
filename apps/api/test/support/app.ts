import { randomUUID } from 'node:crypto';
import { SYSTEM_ROLE_PERMISSIONS, type SystemRole } from '@gatefit/shared';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { Clock } from '../../src/common/clock/clock';
import { SMS_PROVIDER, type SmsProvider } from '../../src/common/sms/sms.provider';
import type { Organization, PrismaClient } from '../../src/generated/prisma/client';
import { PasswordService } from '../../src/modules/auth/password.service';
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
  const user = await admin.user.create({
    data: { phone, passwordHash: await passwords.hash(password) },
  });
  const staff = await admin.staff.create({
    data: { organizationId, userId: user.id, roleId: role.id },
  });

  return { userId: user.id, staffId: staff.id, roleId: role.id, phone, password };
}
