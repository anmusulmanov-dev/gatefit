'use client';

import type { LocationDto, Page, PlanDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useApiGet } from '@/lib/use-api';

import { PlanDialog } from './plan-dialog';
import { PlanTypeBadge, useFreezeText, usePlanSummary, useRestrictionLines } from './plan-ui';

type Editing = { kind: 'new' } | { kind: 'edit'; plan: PlanDto } | null;
type Shown = 'true' | 'false' | 'all';

/** A club rarely has more plans than this; the list is not paged further. */
const PLAN_LIMIT = 100;

export function PlansManager() {
  const t = useTranslations();
  const canManage = useCan('plans.manage');
  const [shown, setShown] = useState<Shown>('true');
  const plans = useApiGet<Page<PlanDto>>(
    `/plans?limit=${String(PLAN_LIMIT)}${shown === 'all' ? '' : `&active=${shown}`}`,
  );
  const locations = useApiGet<LocationDto[]>('/locations?includeArchived=true');
  const [editing, setEditing] = useState<Editing>(null);
  const summary = usePlanSummary();
  const restrictionLines = useRestrictionLines();
  const freezeText = useFreezeText();
  const locationNames = new Map((locations.data ?? []).map((item) => [item.id, item.name]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('plans.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label={t('plans.show')}
            className="w-44"
            value={shown}
            onChange={(event) => {
              setShown(event.target.value as Shown);
            }}
          >
            <option value="true">{t('plans.onSale')}</option>
            <option value="false">{t('plans.withdrawn')}</option>
            <option value="all">{t('plans.all')}</option>
          </Select>
          {canManage && (
            <Button
              onClick={() => {
                setEditing({ kind: 'new' });
              }}
            >
              {t('plans.add')}
            </Button>
          )}
        </div>
      </div>

      {plans.error ? (
        <LoadFailed onRetry={plans.reload} />
      ) : !plans.data ? (
        <Loading />
      ) : plans.data.items.length === 0 ? (
        <Empty>{t('plans.empty')}</Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" aria-busy={plans.loading}>
          {plans.data.items.map((plan) => {
            const limits = restrictionLines(plan.restrictions, locationNames);
            return (
              <li
                key={plan.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{plan.name}</span>
                    <PlanTypeBadge type={plan.type} />
                    {!plan.isActive && <Badge tone="muted">{t('plans.inactive')}</Badge>}
                  </div>
                  <span className="text-sm text-muted-foreground">{summary(plan)}</span>
                  <span className="text-sm text-muted-foreground">
                    {[...limits, freezeText(plan.freeze, plan.currency)].join(' · ')}
                  </span>
                  {plan.description && (
                    <span className="text-sm whitespace-pre-line">{plan.description}</span>
                  )}
                </div>
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing({ kind: 'edit', plan });
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <PlanDialog
          plan={editing.kind === 'edit' ? editing.plan : null}
          locations={(locations.data ?? []).filter(
            (item) =>
              !item.archived ||
              (editing.kind === 'edit' && editing.plan.restrictions.locationIds.includes(item.id)),
          )}
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
