import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_PLAN_MODULES,
  type DefaultPlanKey,
  phoneSchema,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from '@gatefit/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PasswordService } from '../src/common/security/password.service';

// Development and demo data. Safe to run repeatedly: every row is upserted by a natural key.
// Run from apps/api: pnpm --filter api seed

const DEMO_SLUG = 'demo';

const DEMO_LOCATIONS = [
  { name: 'Chilonzor', address: 'Toshkent, Chilonzor tumani' },
  { name: 'Yunusobod', address: 'Toshkent, Yunusobod tumani' },
];

// Demo members: deterministic, so reseeding finds the same people by phone.
const DEMO_MEMBER_COUNT = 30;
const FIRST_NAMES = {
  male: ['Aziz', 'Bekzod', 'Jasur', 'Otabek', 'Sardor', 'Timur', 'Ulugbek', 'Javohir'],
  female: ['Dilnoza', 'Gulnora', 'Madina', 'Nilufar', 'Sevara', 'Zarina', 'Kamola', 'Malika'],
} as const;
const LAST_NAMES = ['Karimov', 'Rahimov', 'Toshmatov', 'Yusupov', 'Aliyev', 'Nazarov', 'Saidov'];
const SOURCES = ['walk_in', 'referral', 'social', 'website'] as const;

// The three tariffs of docs/TZ.md section 12. Prices are placeholders until confirmed
// (UZS per location per month, in tiyin); real ones are set in the platform panel.
const PLANS: Record<
  DefaultPlanKey,
  { name: string; activeMembersPerLocation: number | null; priceMinor: bigint }
> = {
  start: { name: 'Start', activeMembersPerLocation: 200, priceMinor: 30_000_000n },
  standard: { name: 'Standard', activeMembersPerLocation: 1000, priceMinor: 60_000_000n },
  pro: { name: 'Pro', activeMembersPerLocation: null, priceMinor: 120_000_000n },
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (see .env.example)`);
  }
  return value;
}

async function seed(prisma: PrismaClient): Promise<void> {
  // Plans are created once; later edits made in the platform panel are kept.
  const planIds = new Map<string, string>();
  for (const [key, plan] of Object.entries(PLANS)) {
    const row = await prisma.saasPlan.upsert({
      where: { key },
      update: {},
      create: {
        key,
        name: plan.name,
        limits: { activeMembersPerLocation: plan.activeMembersPerLocation },
        modules: DEFAULT_PLAN_MODULES[key as DefaultPlanKey],
        priceMinor: plan.priceMinor,
        currency: 'UZS',
      },
    });
    planIds.set(key, row.id);
  }
  const demoPlanId = planIds.get('standard');
  if (!demoPlanId) {
    throw new Error('The standard plan was not created');
  }

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
      saasPlanId: demoPlanId,
    },
  });
  const organizationId = organization.id;

  // An organization seeded before plans existed gets one now.
  if (!organization.saasPlanId) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { saasPlanId: demoPlanId },
    });
  }
  if ((await prisma.saasSubscription.count({ where: { organizationId } })) === 0) {
    await prisma.saasSubscription.create({
      data: {
        organizationId,
        saasPlanId: demoPlanId,
        billingPeriod: 'monthly',
        startsAt: new Date(),
      },
    });
  }

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

  // The demo owner. An existing staff record keeps its password and authenticator.
  const phone = phoneSchema.parse(requireEnv('SEED_OWNER_PHONE'));
  const passwordHash = await new PasswordService().hash(requireEnv('SEED_OWNER_PASSWORD'));
  const owner = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone } });
  const ownerRoleId = roleIds.get('owner');
  if (!ownerRoleId) {
    throw new Error('The owner role was not created');
  }
  const staff = await prisma.staff.upsert({
    where: { organizationId_userId: { organizationId, userId: owner.id } },
    update: {},
    create: {
      organizationId,
      userId: owner.id,
      roleId: ownerRoleId,
      firstName: 'Demo',
      lastName: 'Owner',
      position: 'Owner',
      passwordHash,
    },
  });
  await prisma.staffLocation.createMany({
    data: locations.map((location) => ({
      organizationId,
      staffId: staff.id,
      locationId: location.id,
    })),
    skipDuplicates: true,
  });

  // Demo members, spread over both locations. Existing ones are left as they are.
  for (let index = 0; index < DEMO_MEMBER_COUNT; index += 1) {
    const gender = index % 2 === 0 ? 'male' : 'female';
    const firstNames = FIRST_NAMES[gender];
    const lastName = LAST_NAMES[index % LAST_NAMES.length] ?? 'Karimov';
    const location = locations[index % locations.length];
    if (!location) {
      throw new Error('No demo location');
    }
    const memberPhone = `+99890000${1000 + index}`;
    await prisma.member.upsert({
      where: { organizationId_phone: { organizationId, phone: memberPhone } },
      update: {},
      create: {
        organizationId,
        homeLocationId: location.id,
        firstName: firstNames[index % firstNames.length] ?? 'Aziz',
        // Uzbek surnames take -a for women: Karimov, Karimova.
        lastName: gender === 'female' ? `${lastName}a` : lastName,
        phone: memberPhone,
        birthDate: new Date(Date.UTC(1975 + (index % 30), index % 12, 1 + (index % 28))),
        gender,
        source: SOURCES[index % SOURCES.length] ?? null,
      },
    });
  }

  // The platform operator. An existing one keeps their password and authenticator.
  const operatorPhone = phoneSchema.parse(requireEnv('SEED_PLATFORM_ADMIN_PHONE'));
  await prisma.platformAdmin.upsert({
    where: { phone: operatorPhone },
    update: {},
    create: {
      phone: operatorPhone,
      name: 'Demo Operator',
      passwordHash: await new PasswordService().hash(requireEnv('SEED_PLATFORM_ADMIN_PASSWORD')),
    },
  });

  console.log(
    `Seeded organization "${organization.slug}": ${locations.length} locations, ${SYSTEM_ROLES.length} roles, 1 owner, ${DEMO_MEMBER_COUNT} members, 3 plans, 1 platform operator (credentials: SEED_* in .env).`,
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
