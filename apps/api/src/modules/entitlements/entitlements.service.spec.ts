import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { type ActiveMemberCounter, EntitlementsService } from './entitlements.service';

function txWithPlan(plan: object | null): TenantTransaction {
  return {
    organization: { findUnique: () => Promise.resolve(plan && { saasPlan: plan }) },
  } as unknown as TenantTransaction;
}

const counting = (count: number): ActiveMemberCounter => ({ count: () => Promise.resolve(count) });

const standard = {
  key: 'standard',
  name: 'Standard',
  modules: ['members', 'schedule', 'not-a-module'],
  limits: { activeMembersPerLocation: 1000 },
};

describe('EntitlementsService', () => {
  it('returns the plan, dropping unknown modules', async () => {
    const service = new EntitlementsService(counting(0));
    await expect(service.forOrganization(txWithPlan(standard), 'org')).resolves.toEqual({
      key: 'standard',
      name: 'Standard',
      modules: ['members', 'schedule'],
      limits: { activeMembersPerLocation: 1000 },
    });
  });

  it('returns null without a plan', async () => {
    const service = new EntitlementsService(counting(0));
    await expect(service.forOrganization(txWithPlan(null), 'org')).resolves.toBeNull();
  });

  it('accepts a module the plan includes and refuses one it lacks', async () => {
    const service = new EntitlementsService(counting(0));
    await expect(
      service.assertModule(txWithPlan(standard), 'org', 'schedule'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertModule(txWithPlan(standard), 'org', 'turnstile'),
    ).rejects.toMatchObject({ code: 'MODULE_NOT_AVAILABLE', status: 403 });
  });

  it('refuses every module when no plan is assigned', async () => {
    const service = new EntitlementsService(counting(0));
    await expect(service.assertModule(txWithPlan(null), 'org', 'members')).rejects.toMatchObject({
      code: 'MODULE_NOT_AVAILABLE',
    });
  });

  describe('memberLimit', () => {
    it('is not exceeded at the limit and is exceeded above it', async () => {
      const atLimit = new EntitlementsService(counting(1000));
      await expect(atLimit.memberLimit(txWithPlan(standard), 'org', 'loc')).resolves.toEqual({
        used: 1000,
        limit: 1000,
        exceeded: false,
      });

      const over = new EntitlementsService(counting(1001));
      await expect(over.memberLimit(txWithPlan(standard), 'org', 'loc')).resolves.toMatchObject({
        exceeded: true,
      });
    });

    it('never reports an unlimited plan as exceeded', async () => {
      const pro = { ...standard, limits: { activeMembersPerLocation: null } };
      const service = new EntitlementsService(counting(50_000));
      await expect(service.memberLimit(txWithPlan(pro), 'org', 'loc')).resolves.toEqual({
        used: 50_000,
        limit: null,
        exceeded: false,
      });
    });
  });
});
