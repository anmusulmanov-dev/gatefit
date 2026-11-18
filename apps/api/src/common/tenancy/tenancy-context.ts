import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../generated/prisma/client';

export interface TenancyStore {
  organizationId: string;
  /** Transaction in which `app.current_org` is set. All tenant queries must go through it. */
  tx: Prisma.TransactionClient;
}

const storage = new AsyncLocalStorage<TenancyStore>();

/** Ambient tenant scope of the current request or job. Opened only by TenantDb. */
export const TenancyContext = {
  run<T>(store: TenancyStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  current(): TenancyStore | undefined {
    return storage.getStore();
  },

  /** Throws instead of silently falling back to an unscoped connection. */
  require(): TenancyStore {
    const store = storage.getStore();
    if (!store) {
      throw new Error('No tenant context: this code must run inside TenantDb.run()');
    }
    return store;
  },
};
