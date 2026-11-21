import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Organization, PrismaClient } from '../../src/generated/prisma/client';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (see test/support/global-setup.ts)`);
  }
  return value;
}

/** Connects as gatefit_migrator: bypasses RLS. For arranging and inspecting test data only. */
export function createAdminClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_ADMIN_URL') }),
  });
}

/** Test files run in parallel against one database, so every organization gets a unique slug. */
export function createOrganization(admin: PrismaClient, name: string): Promise<Organization> {
  return admin.organization.create({
    data: {
      name,
      slug: `${name.toLowerCase()}-${randomUUID()}`,
      country: 'UZ',
      currency: 'UZS',
      locale: 'uz',
    },
  });
}

export function uniquePhone(): string {
  const digits = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`)
    .toString()
    .padStart(9, '0')
    .slice(0, 9);
  return `+998${digits}`;
}

/** A location of the organization for test members, created on first use. */
export function defaultLocation(admin: PrismaClient, organization: Pick<Organization, 'id'>) {
  return admin.location.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Main' } },
    update: {},
    create: { organizationId: organization.id, name: 'Main', timezone: 'Asia/Tashkent' },
  });
}

/** A unique phone registered as a member of each given organization. */
export async function memberPhone(
  admin: PrismaClient,
  ...organizations: Pick<Organization, 'id'>[]
): Promise<string> {
  const phone = uniquePhone();
  for (const organization of organizations) {
    const location = await defaultLocation(admin, organization);
    await admin.member.create({
      data: {
        organizationId: organization.id,
        homeLocationId: location.id,
        firstName: 'Test',
        lastName: 'Member',
        phone,
      },
    });
  }
  return phone;
}

/** A unique phone that is also a real Uzbek mobile number, for code that validates numbers. */
export function uniqueMobile(): string {
  return `+99890${uniquePhone().slice(-7)}`;
}
