'use client';

import type { CashShiftDto, OrganizationDto, Page } from '@gatefit/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import { fromTyped } from '../billing/billing-ui';
import type { MemberScope } from '../members/member-scope';
import { useMemberLocations } from '../members/member-ui';
import { useMoney } from '../plans/plan-ui';

/** A signed minor amount ("-500000") for display. */
function useSignedMoney() {
  const money = useMoney();
  return (minor: string, currency: string) =>
    minor.startsWith('-') ? `−${money(minor.slice(1), currency)}` : money(minor, currency);
}

/** The cash desk of a location (docs/TZ.md F-4.4): open, follow the totals, count and close. */
export function CashShiftDesk({ scope }: { scope: MemberScope }) {
  const t = useTranslations();
  const format = useFormatter();
  const money = useMoney();
  const signed = useSignedMoney();
  const locations = useMemberLocations(scope);
  const organization = useApiGet<OrganizationDto>('/organization');
  const [locationId, setLocationId] = useState(scope.currentLocationId ?? '');
  const location =
    locations.data?.find((item) => item.id === locationId) ?? locations.data?.[0] ?? null;
  const current = useApiGet<{ shift: CashShiftDto | null }>(
    location ? `/cash-shifts/current?locationId=${location.id}` : '/cash-shifts/current',
  );
  const history = useApiGet<Page<CashShiftDto>>(
    location ? `/cash-shifts?locationId=${location.id}&limit=10` : '/cash-shifts?limit=10',
  );
  const action = useApiAction();
  const [opening, setOpening] = useState('0');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const currency = organization.data?.currency ?? 'UZS';
  const shift = current.data?.shift ?? null;

  const reloadAll = () => {
    current.reload();
    history.reload();
  };

  function onOpen(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const openingMinor = fromTyped(opening, currency);
    if (!location || openingMinor === null) {
      action.fail(t('billing.invalidAmount'));
      return;
    }
    action.run(
      () => api.post('/cash-shifts/open', { locationId: location.id, openingMinor }),
      reloadAll,
    );
  }

  function onClose(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const countedMinor = fromTyped(counted, currency);
    if (!shift || countedMinor === null) {
      action.fail(t('billing.invalidAmount'));
      return;
    }
    action.run(
      () =>
        api.post(`/cash-shifts/${shift.id}/close`, {
          countedMinor,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      () => {
        setCounted('');
        setNote('');
        reloadAll();
      },
    );
  }

  const countedMinor = counted ? fromTyped(counted, currency) : null;
  const difference =
    shift && countedMinor !== null
      ? (BigInt(countedMinor) - BigInt(shift.totals.expectedMinor)).toString()
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('billing.shift.title')}</h1>
        {(locations.data?.length ?? 0) > 1 && (
          <Select
            aria-label={t('members.location')}
            className="w-48"
            value={location?.id ?? ''}
            onChange={(event) => {
              setLocationId(event.target.value);
            }}
          >
            {locations.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {current.error ? (
        <LoadFailed onRetry={current.reload} />
      ) : !current.data || !location ? (
        <Loading />
      ) : shift ? (
        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="positive">{t('billing.shift.open')}</Badge>
            <span className="text-sm text-muted-foreground">
              {t('billing.shift.openedAt', {
                time: format.dateTime(new Date(shift.openedAt), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }),
              })}
            </span>
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">{t('billing.shift.opening')}</dt>
            <dd>{money(shift.openingMinor, shift.currency)}</dd>
            <dt className="text-muted-foreground">{t('billing.shift.cashIn')}</dt>
            <dd>{money(shift.totals.cashInMinor, shift.currency)}</dd>
            <dt className="text-muted-foreground">{t('billing.shift.cashRefunds')}</dt>
            <dd>{money(shift.totals.cashRefundsMinor, shift.currency)}</dd>
            <dt className="font-medium">{t('billing.shift.expected')}</dt>
            <dd className="font-medium">{money(shift.totals.expectedMinor, shift.currency)}</dd>
            <dt className="text-muted-foreground">{t('billing.shift.card')}</dt>
            <dd>{money(shift.totals.cardTerminalMinor, shift.currency)}</dd>
            <dt className="text-muted-foreground">{t('billing.shift.transfer')}</dt>
            <dd>{money(shift.totals.transferMinor, shift.currency)}</dd>
            <dt className="text-muted-foreground">{t('billing.shift.count')}</dt>
            <dd>{shift.totals.paymentsCount}</dd>
          </dl>
          <form onSubmit={onClose} className="flex flex-col gap-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="shift-counted"
                label={t('billing.shift.counted')}
                hint={
                  difference !== null
                    ? t('billing.shift.difference', { amount: signed(difference, shift.currency) })
                    : t('billing.amountHint', { currency: shift.currency })
                }
              >
                <Input
                  id="shift-counted"
                  inputMode="decimal"
                  value={counted}
                  onChange={(event) => {
                    setCounted(event.target.value);
                  }}
                />
              </Field>
              <Field
                id="shift-note"
                label={t('billing.shift.note')}
                optional={t('common.optional')}
              >
                <Input
                  id="shift-note"
                  value={note}
                  maxLength={500}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
              </Field>
            </div>
            <FormMessage error={action.error} />
            <FormActions>
              <Button type="submit" disabled={action.pending || !counted}>
                {t('billing.shift.close')}
              </Button>
            </FormActions>
          </form>
        </section>
      ) : (
        <form onSubmit={onOpen} className="flex flex-col gap-3 rounded-lg border p-4" noValidate>
          <p className="text-sm text-muted-foreground">{t('billing.shift.none')}</p>
          <Field
            id="shift-opening"
            label={t('billing.shift.opening')}
            hint={t('billing.amountHint', { currency })}
          >
            <Input
              id="shift-opening"
              inputMode="decimal"
              className="w-48"
              value={opening}
              onChange={(event) => {
                setOpening(event.target.value);
              }}
            />
          </Field>
          <FormMessage error={action.error} />
          <FormActions>
            <Button type="submit" disabled={action.pending}>
              {t('billing.shift.openAction')}
            </Button>
          </FormActions>
        </form>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('billing.shift.history')}</h2>
        {!history.data ? (
          <Loading />
        ) : history.data.items.filter((item) => item.status === 'closed').length === 0 ? (
          <Empty>{t('billing.shift.noHistory')}</Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {history.data.items
              .filter((item) => item.status === 'closed')
              .map((item) => (
                <li key={item.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                  <span className="font-medium">
                    {format.dateTime(new Date(item.openedAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                    {item.closedAt &&
                      ` – ${format.dateTime(new Date(item.closedAt), { timeStyle: 'short' })}`}
                  </span>
                  <span className="text-muted-foreground">
                    {[
                      t('billing.shift.expectedShort', {
                        amount: money(item.totals.expectedMinor, item.currency),
                      }),
                      item.countedMinor &&
                        t('billing.shift.countedShort', {
                          amount: money(item.countedMinor, item.currency),
                        }),
                      item.differenceMinor &&
                        t('billing.shift.difference', {
                          amount: signed(item.differenceMinor, item.currency),
                        }),
                      item.note,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
