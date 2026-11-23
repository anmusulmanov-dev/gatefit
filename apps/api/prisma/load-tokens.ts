import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { QR_REFRESH_SECONDS } from '@gatefit/shared';
import type { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { CryptoService } from '../src/common/crypto/crypto.service';
import type { Env } from '../src/config/env';
import { PrismaClient } from '../src/generated/prisma/client';
import { AccessTokensService } from '../src/modules/access/access-tokens.service';

// QR codes for the load test (infra/load/README.md): members of the demo organization
// with a membership in force, a code for each 30-second step of the next minutes, signed
// with the organization key the API derives from DATA_ENCRYPTION_KEY. Reads only.
//   pnpm --filter api load:tokens [minutes]      writes infra/load/.tokens.json (git-ignored)

const DEMO_SLUG = 'demo';
const MEMBERS = 200;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (see .env.example)`);
  }
  return value;
}

async function main(): Promise<void> {
  const rootEnv = resolve(process.cwd(), '../../.env');
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
  const minutes = Number(process.argv[2] ?? 10);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_ADMIN_URL') }),
  });
  try {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: DEMO_SLUG },
    });
    const memberships = await prisma.membership.findMany({
      where: { organizationId: organization.id, status: 'active', cancelledAt: null },
      select: { memberId: true, locationId: true },
      distinct: ['memberId'],
      take: MEMBERS,
    });
    const key = requireEnv('DATA_ENCRYPTION_KEY');
    const config = { get: () => key } as unknown as ConfigService<Env, true>;
    const tokens = new AccessTokensService(new CryptoService(config));
    const firstStep = Math.floor(Date.now() / 1000 / QR_REFRESH_SECONDS) * QR_REFRESH_SECONDS;
    const steps = Math.ceil((minutes * 60) / QR_REFRESH_SECONDS) + 1;
    const codes = memberships.map((membership) => ({
      locationId: membership.locationId,
      // codes[i] is valid from firstStep + i * 30 s.
      codes: Array.from(
        { length: steps },
        (_, step) =>
          tokens.issue(
            organization.id,
            membership.memberId,
            new Date((firstStep + step * QR_REFRESH_SECONDS) * 1000),
          ).token,
      ),
    }));
    const out = resolve(process.cwd(), '../../infra/load/.tokens.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      JSON.stringify({ firstStep, stepSeconds: QR_REFRESH_SECONDS, members: codes }),
    );
    console.log(
      `Wrote ${String(codes.length)} members × ${String(steps)} codes (${String(minutes)} minutes) to infra/load/.tokens.json`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
