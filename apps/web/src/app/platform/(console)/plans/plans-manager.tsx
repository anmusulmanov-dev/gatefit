'use client';

import { formatMinor, type SaasPlanDto } from '@gatefit/shared';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { platformApi } from '@/lib/platform-api';
import { useApiGet } from '@/lib/use-api';

import { PlanDialog } from './plan-dialog';

type Editing = { kind: 'new' } | { kind: 'edit'; plan: SaasPlanDto } | null;

export function PlansManager() {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const plans = useApiGet<SaasPlanDto[]>('/saas-plans', platformApi);
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">{t('platform.nav.plans')}</h1>
        <Button
          onClick={() => {
            setEditing({ kind: 'new' });
          }}
        >
          {t('platformPlans.add')}
        </Button>
      </div>

      {plans.error ? (
        <LoadFailed onRetry={plans.reload} />
      ) : !plans.data ? (
        <Loading />
      ) : plans.data.length === 0 ? (
        <Empty>{t('platformPlans.empty')}</Empty>
      ) : (
        <ul
          className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50"
          aria-busy={plans.loading}
        >
          {plans.data.map((plan) => {
            const limit = plan.limits.activeMembersPerLocation;
            return (
              <li
                key={plan.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{plan.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{plan.key}</span>
                    {!plan.isActive && <Badge tone="muted">{t('platformPlans.inactive')}</Badge>}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {[
                      `${formatMinor(plan.priceMinor, plan.currency, locale)} / ${t('platformPlans.perLocationMonth')}`,
                      limit === null
                        ? t('platformPlans.unlimited')
                        : t('platformPlans.limitValue', { count: format.number(limit) }),
                      plan.modules.map((module) => t(`modules.${module}`)).join(', '),
                    ].join(' · ')}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing({ kind: 'edit', plan });
                  }}
                >
                  {t('common.edit')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <PlanDialog
          plan={editing.kind === 'edit' ? editing.plan : null}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            plans.reload();
          }}
        />
      )}
    </div>
  );
}
