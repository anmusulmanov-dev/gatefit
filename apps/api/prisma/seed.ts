import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { phoneSchema, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from '@gatefit/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PasswordService } from '../src/modules/auth/password.service';

// Development and demo data. Safe to run repeatedly: every row is upserted by a natural key.
// Run from apps/api: pnpm --filter api seed

const DEMO_SLUG = 'demo';

const DEMO_LOCATIONS = [
  { name: 'Chilonzor', address: 'Toshkent, Chilonzor tumani' },
  { name: 'Yunusobod', address: 'Toshkent, Yunusobod tumani' },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (see .env.example)`);
  }
  return value;
}

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

  const locations = [];
  for (const location of DEMO_LOCATIONS) {
    locations.push(
      await prisma.location.upsert({
        where: { organizationId_name: { organizationId, name: location.name } },
        update: {},
        create: { organizationId, timezone: 'Asia/Tashkent', ...location },
      }),
    );
  }

  // Standard roles always carry exactly the permissions defined in packages/shared.
  const roleIds = new Map<string, string>();
  for (const name of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: {},
      create: { organizationId, name, isSystem: true },
    });
    roleIds.set(name, role.id);

    const permissions = SYSTEM_ROLE_PERMISSIONS[name];
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permission: { notIn: [...permissions] } },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ organizationId, roleId: role.id, permission })),
      skipDuplicates: true,
    });
  }

  // The demo owner. An existing user keeps their password and authenticator.
  const phone = phoneSchema.parse(requireEnv('SEED_OWNER_PHONE'));
  const passwordHash = await new PasswordService().hash(requireEnv('SEED_OWNER_PASSWORD'));
  const owner = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, passwordHash },
  });
  const ownerRoleId = roleIds.get('owner');
  if (!ownerRoleId) {
    throw new Error('The owner role was not created');
  }
  const staff = await prisma.staff.upsert({
    where: { organizationId_userId: { organizationId, userId: owner.id } },
    update: {},
    create: { organizationId, userId: owner.id, roleId: ownerRoleId, position: 'Owner' },
  });
  await prisma.staffLocation.createMany({
    data: locations.map((location) => ({
      organizationId,
      staffId: staff.id,
      locationId: location.id,
    })),
    skipDuplicates: true,
  });

  console.log(
    `Seeded organization "${organization.slug}": ${locations.length} locations, ${SYSTEM_ROLES.length} roles, 1 owner (credentials: SEED_OWNER_* in .env).`,
  );
}

async function main(): Promise<void> {
  const rootEnv = resolve(process.cwd(), '../../.env');
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }

  // Seeding creates organizations and users, which only the schema owner may do.
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_ADMIN_URL') }),
  });
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
