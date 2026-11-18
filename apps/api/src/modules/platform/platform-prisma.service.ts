import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../../config/env';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * The connection that is NOT subject to row-level security: it signs in as
 * gatefit_migrator, the owner of every table. It exists for work that is about all
 * organizations at once, and is provided only inside the platform module (CLAUDE.md
 * rule 1). Never inject it elsewhere; test/platform-boundary.int-spec.ts checks that.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_ADMIN_URL', { infer: true }),
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export type PlatformTransaction = Parameters<
  Parameters<PlatformPrismaService['$transaction']>[0]
>[0];
