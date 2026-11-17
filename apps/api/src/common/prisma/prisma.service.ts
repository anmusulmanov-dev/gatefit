import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../../config/env';
import { type Prisma, PrismaClient } from '../../generated/prisma/client';

// Credentials never ride along with ordinary staff queries: they must be selected
// explicitly, which only StaffCredentialsService does.
const OMITTED = {
  staff: { passwordHash: true, totpSecret: true },
} satisfies Prisma.GlobalOmitConfig;

interface ClientOptions {
  adapter: PrismaPg;
  omit: typeof OMITTED;
}

/** Connects as gatefit_app. Reach tenant data through TenantDb, not through this class. */
@Injectable()
export class PrismaService extends PrismaClient<ClientOptions> implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    const connectionString = config.get('DATABASE_URL', { infer: true });
    super({ adapter: new PrismaPg({ connectionString }), omit: OMITTED });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** The client handed to work running inside a tenant transaction. */
export type TenantTransaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
