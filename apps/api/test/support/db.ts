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
