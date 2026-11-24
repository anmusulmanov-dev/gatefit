'use client';

import { type DailyReportDto, localDate, type PaymentMethod } from '@gatefit/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Field } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useApiGet } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useMethodName } from './billing/billing-ui';
import type { MemberScope } from './members/member-scope';
import { useMemberLocations } from './members/member-ui';
import { useCalendarDate, useMoney } from './plans/plan-ui';

function Stat({
  label,
  value,
  hint,
  hero = false,
}: {
  label: string;
  value: string;
  hint?: string;
  /** The figure the day leads with, drawn in the theme's accent. */
  hero?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-4 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-raised',
        hero && 'gf-hero',
      )}
    >
      <span className={cn('text-sm font-medium', hero ? 'gf-hero-muted' : 'text-muted-foreground')}>
        {label}
      </span>
      <span className="font-numeric text-2xl font-bold tracking-tight break-words tabular-nums sm:text-3xl">
        {value}
      </span>
      {hint && (
        <span className={cn('text-sm', hero ? 'gf-hero-muted' : 'text-muted-foreground')}>
          {hint}
        </span>
      )}
    </div>
  );
}

/** The day of a location on the home screen (docs/TZ.md F-8.1). */
export function DailyReport({ scope }: { scope: MemberScope }) {
  const t = useTranslations('dashboard');
  const money = useMoney();
  const date = useCalendarDate();
  const methodName = useMethodName();
  const locations = useMemberLocations(scope);
  const [locationId, setLocationId] = useState(scope.currentLocationId ?? '');
  const location =
    locations.data?.find((item) => item.id === locationId) ?? locations.data?.[0] ?? null;
  const today = location ? localDate(new Date(), location.timezone) : '';
  const [day, setDay] = useState('');
  const shown = day || today;
  const report = useApiGet<DailyReportDto>(
    location && shown ? `/reports/daily?locationId=${location.id}&date=${shown}` : null,
  );

  if (locations.error) {
    return <LoadFailed onRetry={locations.reload} />;
  }
  if (!locations.data) {
    return <Loading />;
  }
  if (!location) {
    return <Empty>{t('noLocation')}</Empty>;
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="daily-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="daily-title" className="text-xl font-bold">
          {t('title')}
        </h2>
        <div className="flex flex-wrap gap-3">
          {locations.data.length > 1 && (
            <Field id="daily-location" label={t('location')}>
              <Select
                id="daily-location"
                className="w-48"
                value={location.id}
                onChange={(event) => {
                  setLocationId(event.target.value);
                }}
              >
                {locations.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="daily-date" label={t('date')}>
            <Input
              id="daily-date"
              type="date"
              className="w-44"
              value={shown}
              max={today}
              onChange={(event) => {
                setDay(event.target.value);
              }}
            />
          </Field>
        </div>
      </div>

      {report.error ? (
        <LoadFailed onRetry={report.reload} />
      ) : !report.data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4" aria-busy={report.loading}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              hero
              label={t('net')}
              value={money(report.data.netMinor, report.data.currency)}
              hint={
                report.data.refundsMinor !== '0'
                  ? t('refunds', { amount: money(report.data.refundsMinor, report.data.currency) })
                  : undefined
              }
            />
            <Stat label={t('newMembers')} value={String(report.data.newMembers)} />
            <Stat
              label={t('visits')}
              value={String(report.data.visits.entries)}
              hint={t('visitsHint', {
                members: report.data.visits.members,
                refused: report.data.visits.refused,
              })}
            />
            <Stat label={t('expiring')} value={String(report.data.expiring.length)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">{t('byMethod')}</h3>
              {report.data.revenue.length === 0 ? (
                <Empty>{t('noPayments')}</Empty>
              ) : (
                <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50">
                  {report.data.revenue.map((line) => (
                    <li key={line.method} className="flex justify-between gap-3 px-4 py-2 text-sm">
                      <span>
                        {methodName(line.method as PaymentMethod)} ·{' '}
                        <span className="text-muted-foreground">
                          {t('count', { count: line.count })}
                        </span>
                      </span>
                      <span className="font-medium tabular-nums">
                        {money(line.amountMinor, report.data?.currency ?? '')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">{t('expiringTitle')}</h3>
              {report.data.expiring.length === 0 ? (
                <Empty>{t('noExpiring')}</Empty>
              ) : (
                <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50">
                  {report.data.expiring.map((item) => (
                    <li
                      key={item.membershipId}
                      className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm"
                    >
                      <Link
                        href={`/members/${item.member.id}`}
                        className="font-medium hover:underline"
                      >
                        {item.member.lastName} {item.member.firstName}
                      </Link>
                      <span className="text-muted-foreground">
                        {item.planName} · {date(item.endsOn)} · {item.member.phone}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
