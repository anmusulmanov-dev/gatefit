import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService, type TenantTransaction } from '../prisma/prisma.service';
import { TenancyContext } from './tenancy-context';

const organizationIdSchema = z.uuid();

// A request holds one connection for its whole duration; fail fast rather than queue forever.
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/**
 * The only way tenant data is reached. Opens a transaction, binds it to one organization
 * with `set_config('app.current_org', ..., true)` and runs the work inside it, so
 * PostgreSQL RLS filters every statement. The setting is transaction-local: it cannot
 * leak to another request through the connection pool.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  /** Runs `fn` in a transaction scoped to the organization. Commits on success, rolls back on throw. */
  async run<T>(organizationId: string, fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const id = organizationIdSchema.parse(organizationId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.current_org', ${id}, true)`;
      return TenancyContext.run({ organizationId: id, tx }, () => fn(tx));
    }, TRANSACTION_OPTIONS);
  }

  /** The transaction of the surrounding `run()`; throws when called outside of one. */
  get tx(): TenantTransaction {
    return TenancyContext.require().tx;
  }
}
