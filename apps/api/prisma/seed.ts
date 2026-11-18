import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SYSTEM_ROLES } from '@gatefit/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// Development and demo data. Safe to run repeatedly: every row is upserted by a natural key.
// Run from apps/api: pnpm --filter api seed

const DEMO_SLUG = 'demo';

const DEMO_LOCATIONS = [
  { name: 'Chilonzor', address: 'Toshkent, Chilonzor tumani' },
  { name: 'Yunusobod', address: 'Toshkent, Yunusobod tumani' },
];

async function seed(prisma: PrismaClient): Promise<void> {
  const organization = await prisma.organization.upsert({
    where: { slug: DEMO_SLUG },
    update: {},
    create: {
      name: 'Gatefit Demo',
      slug: DEMO_SLUG,
      country: 'UZ',
      currency: 'UZS',
      locale: 'uz',
      status: 'active',
    },
  });
  const organizationId = organization.id;

  for (const location of DEMO_LOCATIONS) {
    await prisma.location.upsert({
      where: { organizationId_name: { organizationId, name: location.name } },
      update: {},
      create: { organizationId, timezone: 'Asia/Tashkent', ...location },
    });
  }

  // Permissions are attached to the standard roles in stage 0.3.
  for (const name of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: {},
      create: { organizationId, name, isSystem: true },
    });
  }

  console.log(
    `Seeded organization "${organization.slug}": ${DEMO_LOCATIONS.length} locations, ${SYSTEM_ROLES.length} roles.`,
  );
}

async function main(): Promise<void> {
  const rootEnv = resolve(process.cwd(), '../../.env');
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) {
    throw new Error('DATABASE_ADMIN_URL is not set');
  }

  // Seeding creates organizations, which only the schema owner may do.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
