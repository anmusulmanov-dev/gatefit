import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addDays,
  DEFAULT_PLAN_MODULES,
  type DefaultPlanKey,
  localDate,
  NO_RESTRICTIONS,
  phoneSchema,
  type PlanRestrictions,
  startOfLocalDay,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  termEndDate,
} from '@gatefit/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Plan, PrismaClient } from '../src/generated/prisma/client';
import { PasswordService } from '../src/common/security/password.service';
import { memberStatusFrom } from '../src/modules/members/member-status';
import {
  type MembershipTerms,
  nextStatusChange,
  statusOn,
} from '../src/modules/plans/membership-rules';

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

// The demo club's own tariffs (docs/TZ.md F-2.1). Found again by name when reseeding.
interface ClubPlan {
  name: string;
  type: Plan['type'];
  durationValue: number;
  durationUnit: Plan['durationUnit'];
  visitLimit: number | null;
  priceMinor: bigint;
  restrictions: PlanRestrictions;
  freeze: { maxDays: number; maxTimes: number; minDays: number; feeMinor: bigint };
}

const NO_FREEZE = { maxDays: 0, maxTimes: 0, minDays: 1, feeMinor: 0n };

const CLUB_PLANS: ClubPlan[] = [
  {
    name: 'Oylik',
    type: 'duration',
    durationValue: 1,
    durationUnit: 'month',
    visitLimit: null,
    priceMinor: 45_000_000n,
    restrictions: NO_RESTRICTIONS,
    freeze: { maxDays: 14, maxTimes: 2, minDays: 3, feeMinor: 0n },
  },
  {
    name: 'Ertalabki oylik',
    type: 'duration',
    durationValue: 1,
    durationUnit: 'month',
    visitLimit: null,
    priceMinor: 30_000_000n,
    restrictions: {
      ...NO_RESTRICTIONS,
      timeWindows: [{ from: '07:00', to: '12:00' }],
      weekdays: [1, 2, 3, 4, 5],
    },
    freeze: NO_FREEZE,
  },
  {
    name: '12 tashrif',
    type: 'visits',
    durationValue: 2,
    durationUnit: 'month',
    visitLimit: 12,
    priceMinor: 35_000_000n,
    restrictions: { ...NO_RESTRICTIONS, dailyVisitLimit: 1 },
    freeze: NO_FREEZE,
  },
  {
    name: 'Yillik',
    type: 'duration',
    durationValue: 1,
    durationUnit: 'year',
    visitLimit: null,
    priceMinor: 400_000_000n,
    restrictions: NO_RESTRICTIONS,
    freeze: { maxDays: 60, maxTimes: 4, minDays: 7, feeMinor: 5_000_000n },
  },
  {
    name: 'Bir martalik',
    type: 'single',
    durationValue: 1,
    durationUnit: 'day',
    visitLimit: 1,
    priceMinor: 5_000_000n,
    restrictions: NO_RESTRICTIONS,
    freeze: NO_FREEZE,
  },
  {
    name: 'Sinov',
    type: 'trial',
    durationValue: 3,
    durationUnit: 'day',
    visitLimit: 1,
    priceMinor: 0n,
    restrictions: NO_RESTRICTIONS,
    freeze: NO_FREEZE,
  },
];

/** Demo memberships, cycled over the members: plan name, days since start, frozen. */
const DEMO_MEMBERSHIPS = [
  { plan: 'Oylik', startedDaysAgo: 5, frozenDays: 0 },
  { plan: 'Oylik', startedDaysAgo: 45, frozenDays: 0 },
  { plan: 'Yillik', startedDaysAgo: 100, frozenDays: 7 },
  { plan: '12 tashrif', startedDaysAgo: 10, frozenDays: 0 },
  { plan: 'Ertalabki oylik', startedDaysAgo: 27, frozenDays: 0 },
] as const;
/** Members beyond this many have no membership yet. */
const DEMO_MEMBERS_WITH_MEMBERSHIPS = 20;

// Demo goods: protein bought by the 5 kg bag and sold by the 30 g portion, and so on.
const SHOP_PRODUCTS: {
  name: string;
  category: string;
  baseUnit: 'piece' | 'gram' | 'ml';
  lowStockThreshold: number;
  units: { name: string; baseQuantity: number; priceMinor: bigint | null }[];
  received: { quantity: number; costMinor: bigint };
}[] = [
  {
    name: 'Whey protein',
    category: 'Sport ovqati',
    baseUnit: 'gram',
    lowStockThreshold: 1000,
    units: [
      { name: 'Qadoq 5 kg', baseQuantity: 5000, priceMinor: null },
      { name: 'Porsiya 30 g', baseQuantity: 30, priceMinor: 1_500_000n },
    ],
    received: { quantity: 10_000, costMinor: 70_000_000n },
  },
  {
    name: 'BCAA',
    category: 'Sport ovqati',
    baseUnit: 'gram',
    lowStockThreshold: 200,
    units: [
      { name: 'Banka 400 g', baseQuantity: 400, priceMinor: 25_000_000n },
      { name: 'Porsiya 10 g', baseQuantity: 10, priceMinor: 800_000n },
    ],
    received: { quantity: 2000, costMinor: 90_000_000n },
  },
  {
    name: 'Protein batonchik',
    category: 'Gazaklar',
    baseUnit: 'piece',
    lowStockThreshold: 10,
    units: [{ name: 'Dona', baseQuantity: 1, priceMinor: 2_500_000n }],
    received: { quantity: 48, costMinor: 72_000_000n },
  },
  {
    name: 'Suv 0,5 l',
    category: 'Ichimliklar',
    baseUnit: 'piece',
    lowStockThreshold: 24,
    units: [{ name: 'Dona', baseQuantity: 1, priceMinor: 500_000n }],
    received: { quantity: 120, costMinor: 36_000_000n },
  },
];

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
  // The platform operator. An existing one keeps their password and authenticator.
  const operatorPhone = phoneSchema.parse(requireEnv('SEED_PLATFORM_ADMIN_PHONE'));
  await prisma.platformAdmin.upsert({
    where: { phone: operatorPhone },
    update: {},
    create: {
      phone: operatorPhone,
      name: 'Platform operator',
      passwordHash: await new PasswordService().hash(requireEnv('SEED_PLATFORM_ADMIN_PASSWORD')),
    },
  });

  // Production seeds the platform only (SEED_DEMO=false): SaaS plans and the first
  // operator. Organizations are then created in the platform panel.
  if (process.env.SEED_DEMO === 'false') {
    console.log('Seeded the platform: 3 SaaS plans, 1 platform operator (no demo organization).');
    return;
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

  // The club's tariffs. Existing ones keep later edits.
  const clubPlans = new Map<string, Plan>();
  for (const plan of CLUB_PLANS) {
    const existing = await prisma.plan.findFirst({ where: { organizationId, name: plan.name } });
    clubPlans.set(
      plan.name,
      existing ??
        (await prisma.plan.create({
          data: {
            organizationId,
            name: plan.name,
            type: plan.type,
            durationValue: plan.durationValue,
            durationUnit: plan.durationUnit,
            visitLimit: plan.visitLimit,
            priceMinor: plan.priceMinor,
            currency: organization.currency,
            restrictions: plan.restrictions,
            freezeMaxDays: plan.freeze.maxDays,
            freezeMaxTimes: plan.freeze.maxTimes,
            freezeMinDays: plan.freeze.minDays,
            freezeFeeMinor: plan.freeze.feeMinor,
          },
        })),
    );
  }

  // The club's shop (docs/TZ.md F-4.8). Each product is created once, with one delivery
  // at every location; later edits and stock changes are kept.
  for (const item of SHOP_PRODUCTS) {
    if (await prisma.product.findFirst({ where: { organizationId, name: item.name } })) {
      continue;
    }
    const product = await prisma.product.create({
      data: {
        organizationId,
        name: item.name,
        category: item.category,
        baseUnit: item.baseUnit,
        lowStockThreshold: item.lowStockThreshold,
        currency: organization.currency,
        units: { create: item.units.map((unit) => ({ ...unit })) },
      },
    });
    for (const location of locations) {
      await prisma.stockLevel.create({
        data: {
          organizationId,
          productId: product.id,
          locationId: location.id,
          onHand: item.received.quantity,
          valueMinor: item.received.costMinor,
        },
      });
      await prisma.stockMovement.create({
        data: {
          organizationId,
          productId: product.id,
          locationId: location.id,
          kind: 'receipt',
          quantityDelta: item.received.quantity,
          valueDeltaMinor: item.received.costMinor,
          currency: organization.currency,
          supplier: 'Demo',
          createdBy: owner.id,
        },
      });
    }
  }

  // Demo memberships, dated from today, for members who have none: in force, expired,
  // frozen. Statuses are computed by the same rules the API uses.
  const now = new Date();
  const demoMembers = await prisma.member.findMany({
    where: { organizationId, phone: { startsWith: '+99890000' } },
    orderBy: { phone: 'asc' },
    take: DEMO_MEMBERS_WITH_MEMBERSHIPS,
    include: { homeLocation: true, memberships: { select: { id: true } } },
  });
  for (const [index, member] of demoMembers.entries()) {
    const spec = DEMO_MEMBERSHIPS[index % DEMO_MEMBERSHIPS.length];
    const plan = spec && clubPlans.get(spec.plan);
    if (!spec || !plan || member.memberships.length > 0) {
      continue;
    }
    const timeZone = member.homeLocation.timezone;
    const today = localDate(now, timeZone);
    const startsOn = addDays(today, -spec.startedDaysAgo);
    const freezeStartsOn = addDays(today, -2);
    const freezeEndsOn = addDays(freezeStartsOn, spec.frozenDays - 1);
    const terms: MembershipTerms = {
      startsOn,
      endsOn: addDays(
        termEndDate(startsOn, plan.durationValue, plan.durationUnit),
        spec.frozenDays,
      ),
      visitsLeft: plan.visitLimit === null ? null : plan.visitLimit - (index % 5),
      cancelled: false,
      freezes:
        spec.frozenDays > 0
          ? [
              {
                startsOn: freezeStartsOn,
                endsOn: freezeEndsOn,
                days: spec.frozenDays,
                cancelled: false,
              },
            ]
          : [],
    };
    const status = statusOn(terms, today);
    const membership = await prisma.membership.create({
      data: {
        organizationId,
        memberId: member.id,
        planId: plan.id,
        locationId: member.homeLocationId,
        planName: plan.name,
        planType: plan.type,
        visitLimit: plan.visitLimit,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        restrictions: plan.restrictions ?? {},
        freezeMaxDays: plan.freezeMaxDays,
        freezeMaxTimes: plan.freezeMaxTimes,
        freezeMinDays: plan.freezeMinDays,
        freezeFeeMinor: plan.freezeFeeMinor,
        startsOn: new Date(`${terms.startsOn}T00:00:00Z`),
        endsOn: new Date(`${terms.endsOn}T00:00:00Z`),
        startsAt: startOfLocalDay(terms.startsOn, timeZone),
        endsAt: startOfLocalDay(addDays(terms.endsOn, 1), timeZone),
        visitsLeft: terms.visitsLeft,
        status,
        statusChangesAt: nextStatusChange(terms, now, timeZone),
        soldBy: owner.id,
      },
    });
    if (spec.frozenDays > 0) {
      await prisma.membershipFreeze.create({
        data: {
          organizationId,
          membershipId: membership.id,
          startsOn: new Date(`${freezeStartsOn}T00:00:00Z`),
          endsOn: new Date(`${freezeEndsOn}T00:00:00Z`),
          startsAt: startOfLocalDay(freezeStartsOn, timeZone),
          endsAt: startOfLocalDay(addDays(freezeEndsOn, 1), timeZone),
          days: spec.frozenDays,
          reason: 'Safar',
          source: 'member_request',
          feeMinor: plan.freezeFeeMinor,
          currency: plan.currency,
          createdBy: owner.id,
        },
      });
    }
    // Billed and paid by card on the first day; one member paid half and owes the rest.
    let debtor = false;
    if (plan.priceMinor > 0n) {
      const paidMinor = index === 3 ? plan.priceMinor / 2n : plan.priceMinor;
      debtor = paidMinor < plan.priceMinor;
      const year = Number(today.slice(0, 4));
      const [counter] = await prisma.$queryRaw<{ last: number }[]>`
        INSERT INTO invoice_counters (organization_id, year, last)
        VALUES (${organizationId}::uuid, ${year}, 1)
        ON CONFLICT (organization_id, year) DO UPDATE SET last = invoice_counters.last + 1
        RETURNING last`;
      const invoice = await prisma.invoice.create({
        data: {
          organizationId,
          number: `${String(year)}-${String(counter?.last ?? 1).padStart(6, '0')}`,
          memberId: member.id,
          locationId: member.homeLocationId,
          currency: plan.currency,
          totalMinor: plan.priceMinor,
          paidMinor,
          status: debtor ? 'partially_paid' : 'paid',
          dueAt: membership.startsAt,
          overdueMarkedAt: now,
          createdBy: owner.id,
          items: {
            create: [
              {
                kind: 'membership',
                description: plan.name,
                quantity: 1,
                unitMinor: plan.priceMinor,
                totalMinor: plan.priceMinor,
                membershipId: membership.id,
              },
            ],
          },
        },
      });
      await prisma.payment.create({
        data: {
          organizationId,
          invoiceId: invoice.id,
          memberId: member.id,
          locationId: member.homeLocationId,
          method: 'card_terminal',
          amountMinor: paidMinor,
          currency: plan.currency,
          receivedBy: owner.id,
          createdAt: membership.startsAt,
        },
      });
    }
    await prisma.member.update({
      where: { id: member.id },
      data: { status: memberStatusFrom(member.status, [status], debtor) },
    });
  }

  console.log(
    `Seeded organization "${organization.slug}": ${locations.length} locations, ${SYSTEM_ROLES.length} roles, 1 owner, ${DEMO_MEMBER_COUNT} members, ${CLUB_PLANS.length} club plans, ${SHOP_PRODUCTS.length} shop products, demo memberships, 3 SaaS plans, 1 platform operator (credentials: SEED_* in .env).`,
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
