import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { addDays, daysBetween, localDate, startOfLocalDay, termEndDate } from '@gatefit/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Plan, type PaymentMethod, PrismaClient } from '../src/generated/prisma/client';
import { uuidv7 } from '../src/common/ids/uuid-v7';
import { memberStatusFrom } from '../src/modules/members/member-status';
import {
  type MembershipTerms,
  nextStatusChange,
  statusOn,
} from '../src/modules/plans/membership-rules';

// A busier demo organization for staging and load tests (docs/PROMPTS.md M8): 300
// members, memberships sold over the last month with their payments, and a month of
// visits. Runs after the main seed (pnpm --filter api seed), which creates the
// organization, its locations and plans. Safe to run again: members are upserted by phone,
// and a member who already has memberships or visits gets no new ones.
//   pnpm --filter api seed:demo

const DEMO_SLUG = 'demo';
const MEMBERS = 300;
const PHONE_PREFIX = '+99890002';
const DAYS = 30;
/** Share of members with a membership; the rest walked in once and did not buy. */
const BUYERS = 0.85;
const SELLING = [
  { plan: 'Oylik', weight: 6 },
  { plan: 'Ertalabki oylik', weight: 2 },
  { plan: '12 tashrif', weight: 2 },
  { plan: 'Yillik', weight: 1 },
] as const;
const METHODS: { method: PaymentMethod; weight: number }[] = [
  { method: 'cash', weight: 5 },
  { method: 'card_terminal', weight: 4 },
  { method: 'transfer', weight: 1 },
];
const FIRST = [
  'Aziz',
  'Dilnoza',
  'Jasur',
  'Malika',
  'Sardor',
  'Nodira',
  'Bekzod',
  'Zarina',
  'Otabek',
  'Gulnora',
  'Timur',
  'Madina',
];
const LAST = [
  'Karimov',
  'Rahimov',
  'Aliyev',
  'Saidov',
  'Yusupov',
  'Tursunov',
  'Ismoilov',
  'Nazarov',
  'Qodirov',
  'Ergashev',
];

/** Deterministic randomness: the same demo every time. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T extends { weight: number }>(items: readonly T[], roll: number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let left = roll * total;
  for (const item of items) {
    left -= item.weight;
    if (left < 0) {
      return item;
    }
  }
  return items[items.length - 1] as T;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (see .env.example)`);
  }
  return value;
}

/** An instant on a calendar day at a local hour (fraction allowed) in the zone. */
function at(day: string, hour: number, timeZone: string): Date {
  return new Date(startOfLocalDay(day, timeZone).getTime() + hour * 60 * 60 * 1000);
}

async function seedDemo(prisma: PrismaClient): Promise<void> {
  const organization = await prisma.organization.findUnique({ where: { slug: DEMO_SLUG } });
  if (!organization) {
    throw new Error('The demo organization does not exist: run pnpm --filter api seed first');
  }
  const organizationId = organization.id;
  const owner = await prisma.user.findUniqueOrThrow({
    where: { phone: requireEnv('SEED_OWNER_PHONE') },
  });
  const locations = await prisma.location.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  const plans = new Map<string, Plan>();
  for (const { plan: name } of SELLING) {
    const plan = await prisma.plan.findFirst({ where: { organizationId, name } });
    if (!plan) {
      throw new Error(`Plan "${name}" is missing: run pnpm --filter api seed first`);
    }
    plans.set(name, plan);
  }

  const now = new Date();
  let sold = 0;
  let visits = 0;
  for (let index = 0; index < MEMBERS; index += 1) {
    // Each member has their own sequence: skipping one on a rerun shifts nobody else's.
    const roll = random(1000 + index);
    const location = locations[index % locations.length];
    if (!location) {
      throw new Error('The demo organization has no locations');
    }
    const zone = location.timezone;
    const today = localDate(now, zone);
    const female = index % 2 === 1;
    const last = LAST[index % LAST.length] ?? 'Karimov';
    const joinedDaysAgo = Math.floor(roll() * 60);
    const member = await prisma.member.upsert({
      where: {
        organizationId_phone: {
          organizationId,
          phone: `${PHONE_PREFIX}${String(index).padStart(4, '0')}`,
        },
      },
      update: {},
      create: {
        organizationId,
        homeLocationId: location.id,
        firstName: FIRST[(index * 7) % FIRST.length] ?? 'Aziz',
        lastName: female ? `${last}a` : last,
        phone: `${PHONE_PREFIX}${String(index).padStart(4, '0')}`,
        gender: female ? 'female' : 'male',
        source: 'walk_in',
        createdAt: at(addDays(today, -joinedDaysAgo), 10 + roll() * 9, zone),
      },
      include: { memberships: { select: { id: true } } },
    });
    const buys = roll() < BUYERS;
    const choice = pick(SELLING, roll());
    const startedDaysAgo = Math.floor(roll() * DAYS);
    const method = pick(METHODS, roll()).method;
    const keen = 0.25 + roll() * 0.45;
    if (!buys || member.memberships.length > 0) {
      continue;
    }

    const plan = plans.get(choice.plan) as Plan;
    const startsOn = addDays(today, -startedDaysAgo);
    const endsOn = termEndDate(startsOn, plan.durationValue, plan.durationUnit);
    const soldAt = at(startsOn, 9 + roll() * 11, zone);

    // A month of visits: on each day, by how keen the member is; visit plans run out.
    const entries: Date[] = [];
    for (let day = startsOn; day <= today && day <= endsOn; day = addDays(day, 1)) {
      if (roll() < keen) {
        const instant = at(day, 7 + roll() * 15, zone);
        if (instant.getTime() <= now.getTime()) {
          entries.push(instant);
        }
      }
    }
    const usable = plan.visitLimit === null ? entries : entries.slice(0, plan.visitLimit);
    const terms: MembershipTerms = {
      startsOn,
      endsOn,
      visitsLeft: plan.visitLimit === null ? null : plan.visitLimit - usable.length,
      cancelled: false,
      freezes: [],
    };
    const status = statusOn(terms, today);
    const membership = await prisma.membership.create({
      data: {
        organizationId,
        memberId: member.id,
        planId: plan.id,
        locationId: location.id,
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
        startsOn: new Date(`${startsOn}T00:00:00Z`),
        endsOn: new Date(`${endsOn}T00:00:00Z`),
        startsAt: startOfLocalDay(startsOn, zone),
        endsAt: startOfLocalDay(addDays(endsOn, 1), zone),
        visitsLeft: terms.visitsLeft,
        status,
        statusChangesAt: nextStatusChange(terms, now, zone),
        soldBy: owner.id,
        createdAt: soldAt,
      },
    });

    // Paid in full when sold.
    const year = Number(startsOn.slice(0, 4));
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
        locationId: location.id,
        currency: plan.currency,
        totalMinor: plan.priceMinor,
        paidMinor: plan.priceMinor,
        status: 'paid',
        dueAt: soldAt,
        createdBy: owner.id,
        createdAt: soldAt,
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
        locationId: location.id,
        method,
        amountMinor: plan.priceMinor,
        currency: plan.currency,
        receivedBy: owner.id,
        createdAt: soldAt,
      },
    });

    const rows = entries.map((entry, position) => {
      const allowed = position < usable.length;
      return {
        id: uuidv7(entry),
        organizationId,
        at: entry,
        locationId: location.id,
        memberId: member.id,
        membershipId: allowed ? membership.id : null,
        direction: 'in' as const,
        method: 'qr' as const,
        result: allowed ? ('allowed' as const) : ('denied' as const),
        denyReason: allowed ? null : 'membership_expired',
        recordedBy: owner.id,
        createdAt: entry,
      };
    });
    if (rows.length > 0) {
      await prisma.checkIn.createMany({ data: rows });
    }
    await prisma.member.update({
      where: { id: member.id },
      data: { status: memberStatusFrom(member.status, [status], false) },
    });
    sold += 1;
    visits += rows.length;
    if (daysBetween(startsOn, today) < 0) {
      throw new Error('A membership started in the future');
    }
  }
  console.log(
    `Demo data: ${String(MEMBERS)} members (${PHONE_PREFIX}xxxx), ${String(sold)} new memberships with payments, ${String(visits)} visits over ${String(DAYS)} days.`,
  );
}

async function main(): Promise<void> {
  const rootEnv = resolve(process.cwd(), '../../.env');
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_ADMIN_URL') }),
  });
  try {
    await seedDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
