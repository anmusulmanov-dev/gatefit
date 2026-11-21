'use client';

import {
  currencyDigits,
  decimalToMinor,
  DURATION_UNITS,
  type DurationUnit,
  type LocationDto,
  minorToDecimal,
  type OrganizationDto,
  planCreateSchema,
  type PlanDto,
  PLAN_TYPES,
  type PlanType,
  planUpdateSchema,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { CheckboxRow, Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import { weekdayKey } from './plan-ui';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Whole number typed in a field, or null when empty or not a number. */
function wholeNumber(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number.parseInt(value, 10) : null;
}

/** Creates a plan (`plan` is null) or edits one. Prices are typed in major units. */
export function PlanDialog({
  plan,
  locations,
  onClose,
  onSaved,
}: {
  plan: PlanDto | null;
  locations: LocationDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const organization = useApiGet<OrganizationDto>('/organization');
  const currency = plan?.currency ?? organization.data?.currency ?? 'UZS';
  const digits = currencyDigits(currency);

  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [type, setType] = useState<PlanType>(plan?.type ?? 'duration');
  const [durationValue, setDurationValue] = useState(String(plan?.durationValue ?? 1));
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(plan?.durationUnit ?? 'month');
  const [visitLimit, setVisitLimit] = useState(String(plan?.visitLimit ?? ''));
  const [price, setPrice] = useState(
    plan ? minorToDecimal(plan.priceMinor, currencyDigits(plan.currency)) : '',
  );
  const [windows, setWindows] = useState(plan?.restrictions.timeWindows ?? []);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(plan?.restrictions.weekdays ?? []));
  const [dailyLimit, setDailyLimit] = useState(String(plan?.restrictions.dailyVisitLimit ?? ''));
  const [locationIds, setLocationIds] = useState<Set<string>>(
    new Set(plan?.restrictions.locationIds ?? []),
  );
  const [freezeAllowed, setFreezeAllowed] = useState((plan?.freeze.maxDays ?? 0) > 0);
  const [freezeMaxDays, setFreezeMaxDays] = useState(String(plan?.freeze.maxDays || 14));
  const [freezeMaxTimes, setFreezeMaxTimes] = useState(String(plan?.freeze.maxTimes || 2));
  const [freezeMinDays, setFreezeMinDays] = useState(String(plan?.freeze.minDays ?? 3));
  const [freezeFee, setFreezeFee] = useState(
    plan ? minorToDecimal(plan.freeze.feeMinor, currencyDigits(plan.currency)) : '0',
  );
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);

  const hasVisitLimit = type === 'visits' || type === 'trial';

  function toggle<T>(set: Set<T>, value: T, on: boolean): Set<T> {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // String arithmetic only: prices never pass through a floating-point number.
    const priceMinor = decimalToMinor(price, digits);
    const feeMinor = freezeAllowed ? decimalToMinor(freezeFee, digits) : '0';
    if (priceMinor === null || feeMinor === null) {
      action.fail(t('plans.invalidPrice', { digits }));
      return;
    }
    const values = {
      name,
      description,
      type,
      durationValue: wholeNumber(durationValue),
      durationUnit,
      visitLimit: type === 'single' ? 1 : hasVisitLimit ? wholeNumber(visitLimit) : null,
      priceMinor,
      restrictions: {
        timeWindows: windows,
        weekdays: [...weekdays],
        dailyVisitLimit: wholeNumber(dailyLimit),
        locationIds: [...locationIds],
      },
      freeze: freezeAllowed
        ? {
            maxDays: wholeNumber(freezeMaxDays),
            maxTimes: wholeNumber(freezeMaxTimes),
            minDays: wholeNumber(freezeMinDays),
            feeMinor,
          }
        : { maxDays: 0, maxTimes: 0, minDays: 1, feeMinor: '0' },
    };

    if (plan) {
      const input = planUpdateSchema.safeParse({ ...values, isActive });
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.patch(`/plans/${plan.id}`, input.data), onSaved);
    } else {
      const input = planCreateSchema.safeParse(values);
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.post('/plans', input.data), onSaved);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={plan ? t('plans.edit') : t('plans.add')}
      description={plan ? t('plans.changeWarning') : undefined}
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="plan-name" label={t('plans.fields.name')}>
            <Input
              id="plan-name"
              value={name}
              required
              maxLength={80}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <Field id="plan-type" label={t('plans.fields.type')}>
            <Select
              id="plan-type"
              value={type}
              onChange={(event) => {
                setType(event.target.value as PlanType);
              }}
            >
              {PLAN_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`plans.types.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="plan-duration" label={t('plans.fields.duration')}>
            <div className="flex gap-2">
              <Input
                id="plan-duration"
                type="number"
                min={1}
                inputMode="numeric"
                className="w-24"
                value={durationValue}
                onChange={(event) => {
                  setDurationValue(event.target.value);
                }}
              />
              <Select
                aria-label={t('plans.fields.durationUnit')}
                value={durationUnit}
                onChange={(event) => {
                  setDurationUnit(event.target.value as DurationUnit);
                }}
              >
                {DURATION_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`plans.unitNames.${unit}`)}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          {hasVisitLimit && (
            <Field
              id="plan-visits"
              label={t('plans.fields.visitLimit')}
              optional={type === 'trial' ? t('common.optional') : undefined}
            >
              <Input
                id="plan-visits"
                type="number"
                min={1}
                inputMode="numeric"
                value={visitLimit}
                onChange={(event) => {
                  setVisitLimit(event.target.value);
                }}
              />
            </Field>
          )}
          <Field
            id="plan-price"
            label={t('plans.fields.price')}
            hint={t('plans.fields.priceHint', { currency })}
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
        </div>
        <Field
          id="plan-description"
          label={t('plans.fields.description')}
          optional={t('common.optional')}
        >
          <textarea
            id="plan-description"
            className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-base"
            value={description}
            maxLength={1000}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>

        <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{t('plans.fields.restrictions')}</legend>
          <div className="flex flex-col gap-2">
            <span className="text-sm">{t('plans.fields.timeWindows')}</span>
            {windows.length === 0 && (
              <span className="text-sm text-muted-foreground">{t('plans.fields.anyTime')}</span>
            )}
            {windows.map((window, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Input
                  type="time"
                  aria-label={t('plans.fields.from')}
                  className="w-32"
                  value={window.from}
                  onChange={(event) => {
                    setWindows(
                      windows.map((w, i) => (i === index ? { ...w, from: event.target.value } : w)),
                    );
                  }}
                />
                <span aria-hidden>–</span>
                <Input
                  type="time"
                  aria-label={t('plans.fields.to')}
                  className="w-32"
                  value={window.to}
                  onChange={(event) => {
                    setWindows(
                      windows.map((w, i) => (i === index ? { ...w, to: event.target.value } : w)),
                    );
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setWindows(windows.filter((_, i) => i !== index));
                  }}
                >
                  {t('plans.fields.removeWindow')}
                </Button>
              </div>
            ))}
            {windows.length < 4 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => {
                  setWindows([...windows, { from: '07:00', to: '12:00' }]);
                }}
              >
                {t('plans.fields.addWindow')}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm">
              {t('plans.fields.weekdays')}{' '}
              <span className="text-muted-foreground">({t('plans.fields.noneMeansAll')})</span>
            </span>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((day) => (
                <CheckboxRow
                  key={day}
                  label={t(`plans.weekdays.${weekdayKey(day)}`)}
                  checked={weekdays.has(day)}
                  onChange={(event) => {
                    setWeekdays(toggle(weekdays, day, event.target.checked));
                  }}
                />
              ))}
            </div>
          </div>

          <Field
            id="plan-daily"
            label={t('plans.fields.dailyVisitLimit')}
            optional={t('common.optional')}
          >
            <Input
              id="plan-daily"
              type="number"
              min={1}
              inputMode="numeric"
              className="w-24"
              value={dailyLimit}
              onChange={(event) => {
                setDailyLimit(event.target.value);
              }}
            />
          </Field>

          {locations.length > 1 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm">
                {t('plans.fields.locations')}{' '}
                <span className="text-muted-foreground">({t('plans.fields.noneMeansAll')})</span>
              </span>
              <div className="flex flex-wrap gap-3">
                {locations.map((location) => (
                  <CheckboxRow
                    key={location.id}
                    label={location.name}
                    checked={locationIds.has(location.id)}
                    onChange={(event) => {
                      setLocationIds(toggle(locationIds, location.id, event.target.checked));
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{t('plans.fields.freeze')}</legend>
          <CheckboxRow
            label={t('plans.fields.freezeAllowed')}
            checked={freezeAllowed}
            onChange={(event) => {
              setFreezeAllowed(event.target.checked);
            }}
          />
          {freezeAllowed && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="freeze-days" label={t('plans.fields.freezeMaxDays')}>
                <Input
                  id="freeze-days"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={freezeMaxDays}
                  onChange={(event) => {
                    setFreezeMaxDays(event.target.value);
                  }}
                />
              </Field>
              <Field id="freeze-times" label={t('plans.fields.freezeMaxTimes')}>
                <Input
                  id="freeze-times"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={freezeMaxTimes}
                  onChange={(event) => {
                    setFreezeMaxTimes(event.target.value);
                  }}
                />
              </Field>
              <Field id="freeze-min" label={t('plans.fields.freezeMinDays')}>
                <Input
                  id="freeze-min"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={freezeMinDays}
                  onChange={(event) => {
                    setFreezeMinDays(event.target.value);
                  }}
                />
              </Field>
              <Field
                id="freeze-fee"
                label={t('plans.fields.freezeFee')}
                hint={t('plans.fields.freezeFeeHint', { currency })}
              >
                <Input
                  id="freeze-fee"
                  inputMode="decimal"
                  value={freezeFee}
                  onChange={(event) => {
                    setFreezeFee(event.target.value);
                  }}
                />
              </Field>
            </div>
          )}
        </fieldset>

        {plan && (
          <CheckboxRow
            label={t('plans.fields.active')}
            checked={isActive}
            onChange={(event) => {
              setIsActive(event.target.checked);
            }}
          />
        )}
        {plan && !isActive && (
          <p className="text-sm text-muted-foreground">{t('plans.fields.activeHint')}</p>
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
