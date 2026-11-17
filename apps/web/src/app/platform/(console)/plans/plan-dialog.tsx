'use client';

import {
  currencyDigits,
  decimalToMinor,
  minorToDecimal,
  SAAS_MODULES,
  type SaasModule,
  saasPlanCreateSchema,
  type SaasPlanDto,
  saasPlanUpdateSchema,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { CheckboxRow, Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { platformApi } from '@/lib/platform-api';
import { useApiAction } from '@/lib/use-api';

/** Creates a plan (`plan` is null) or edits one. Prices are typed in major units. */
export function PlanDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: SaasPlanDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();

  const [key, setKey] = useState(plan?.key ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [currency, setCurrency] = useState(plan?.currency ?? 'UZS');
  const [price, setPrice] = useState(
    plan ? minorToDecimal(plan.priceMinor, currencyDigits(plan.currency)) : '',
  );
  const [unlimited, setUnlimited] = useState(plan?.limits.activeMembersPerLocation === null);
  const [limit, setLimit] = useState(String(plan?.limits.activeMembersPerLocation ?? 200));
  const [modules, setModules] = useState<Set<SaasModule>>(new Set(plan?.modules ?? []));
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);

  const normalizedCurrency = currency.trim().toUpperCase();
  const digits = currencyDigits(normalizedCurrency);

  function toggleModule(module: SaasModule, on: boolean) {
    setModules((current) => {
      const next = new Set(current);
      if (on) next.add(module);
      else next.delete(module);
      return next;
    });
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // String arithmetic only: the price never passes through a floating-point number.
    const priceMinor = decimalToMinor(price, digits);
    if (priceMinor === null) {
      action.fail(t('platformPlans.invalidPrice', { digits }));
      return;
    }
    const values = {
      name,
      currency: normalizedCurrency,
      priceMinor,
      limits: { activeMembersPerLocation: unlimited ? null : Number.parseInt(limit, 10) },
      // Catalogue order, so plans list their modules the same way.
      modules: SAAS_MODULES.filter((module) => modules.has(module)),
    };

    if (plan) {
      const input = saasPlanUpdateSchema.safeParse({ ...values, isActive });
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => platformApi.patch(`/saas-plans/${plan.id}`, input.data), onSaved);
    } else {
      const input = saasPlanCreateSchema.safeParse({ ...values, key: key.trim() });
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => platformApi.post('/saas-plans', input.data), onSaved);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={plan ? t('platformPlans.edit') : t('platformPlans.add')}
      description={plan ? t('platformPlans.changeWarning') : undefined}
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="plan-key" label={t('platformPlans.key')} hint={t('platformPlans.keyHint')}>
            <Input
              id="plan-key"
              className="font-mono"
              value={key}
              disabled={!!plan}
              required
              maxLength={31}
              spellCheck={false}
              autoCapitalize="none"
              autoFocus={!plan}
              onChange={(event) => {
                setKey(event.target.value);
              }}
            />
          </Field>
          <Field id="plan-name" label={t('platformPlans.name')}>
            <Input
              id="plan-name"
              value={name}
              required
              maxLength={60}
              autoFocus={!!plan}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <Field
            id="plan-price"
            label={t('platformPlans.price')}
            hint={t('platformPlans.priceHint', { currency: normalizedCurrency })}
          >
            <Input
              id="plan-price"
              inputMode="decimal"
              value={price}
              required
              onChange={(event) => {
                setPrice(event.target.value);
              }}
            />
          </Field>
          <Field id="plan-currency" label={t('platformPlans.currency')}>
            <Input
              id="plan-currency"
              value={currency}
              required
              maxLength={3}
              onChange={(event) => {
                setCurrency(event.target.value);
              }}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('platformPlans.limit')}</legend>
          <CheckboxRow
            label={t('platformPlans.unlimited')}
            checked={unlimited}
            onChange={(event) => {
              setUnlimited(event.target.checked);
            }}
          />
          {!unlimited && (
            <Input
              type="number"
              aria-label={t('platformPlans.limit')}
              className="w-40"
              min={1}
              inputMode="numeric"
              value={limit}
              onChange={(event) => {
                setLimit(event.target.value);
              }}
            />
          )}
        </fieldset>

        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">{t('platformPlans.modules')}</legend>
          {SAAS_MODULES.map((module) => (
            <CheckboxRow
              key={module}
              label={t(`modules.${module}`)}
              checked={modules.has(module)}
              onChange={(event) => {
                toggleModule(module, event.target.checked);
              }}
            />
          ))}
        </fieldset>

        {plan && (
          <CheckboxRow
            label={t('platformPlans.active')}
            checked={isActive}
            onChange={(event) => {
              setIsActive(event.target.checked);
            }}
          />
        )}
        {plan && !isActive && (
          <p className="text-sm text-muted-foreground">{t('platformPlans.activeHint')}</p>
        )}

        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending}>
            {t('common.save')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
