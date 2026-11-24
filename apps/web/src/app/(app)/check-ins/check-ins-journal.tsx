'use client';

import {
  addDays,
  type CheckInDto,
  type CheckInResult,
  localDate,
  type Page,
  startOfLocalDay,
} from '@gatefit/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Field } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useApiGet } from '@/lib/use-api';

import type { MemberScope } from '../members/member-scope';
import { useMemberLocations } from '../members/member-ui';
import { CheckInBadge, useCheckInTime, useMethodText } from '../reception/access-ui';

/** The entry journal (docs/TZ.md F-3.3): who came in or was refused at a location, by day. */
export function CheckInsJournal({ scope }: { scope: MemberScope }) {
  const t = useTranslations('access');
  const locations = useMemberLocations(scope);
  const time = useCheckInTime();
  const methodText = useMethodText();
  const [locationId, setLocationId] = useState(scope.currentLocationId ?? '');
  const location =
    locations.data?.find((item) => item.id === locationId) ?? locations.data?.[0] ?? null;
  const timeZone = location?.timezone ?? 'UTC';
  const today = localDate(new Date(), timeZone);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<CheckInResult | ''>('');

  const fromDay = from || today;
  const toDay = to || fromDay;
  const query = new URLSearchParams({ limit: '100' });
  query.set('from', startOfLocalDay(fromDay, timeZone).toISOString());
  query.set('to', startOfLocalDay(addDays(toDay, 1), timeZone).toISOString());
  if (location) query.set('locationId', location.id);
  if (result) query.set('result', result);
  // Wait for the location: its time zone decides where the days start.
  const checkIns = useApiGet<Page<CheckInDto>>(location ? `/check-ins?${query.toString()}` : null);
  const items = checkIns.data?.items ?? [];
  const multiDay = fromDay !== toDay;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('journal.title')}</h1>
      <div className="grid gap-3 sm:grid-cols-4">
        {(locations.data?.length ?? 0) > 1 && (
          <Field id="check-ins-location" label={t('location')}>
            <Select
              id="check-ins-location"
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
          </Field>
        )}
        <Field id="check-ins-from" label={t('journal.from')}>
          <Input
            id="check-ins-from"
            type="date"
            value={fromDay}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field id="check-ins-to" label={t('journal.to')}>
          <Input
            id="check-ins-to"
            type="date"
            value={toDay}
            min={fromDay}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
        <Field id="check-ins-result" label={t('journal.result')}>
          <Select
            id="check-ins-result"
            value={result}
            onChange={(event) => {
              setResult(event.target.value as CheckInResult | '');
            }}
          >
            <option value="">{t('journal.all')}</option>
            <option value="allowed">{t('journal.allowed')}</option>
            <option value="denied">{t('journal.denied')}</option>
          </Select>
        </Field>
      </div>

      {checkIns.error ? (
        <LoadFailed onRetry={checkIns.reload} />
      ) : !checkIns.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>{t('journal.empty')}</Empty>
      ) : (
        <>
          <p className="text-sm">{t('journal.count', { count: items.length })}</p>
          <ul
            className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50"
            aria-busy={checkIns.loading}
          >
            {items.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-4 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">
                    {time(entry, multiDay)}
                  </span>
                  <Link
                    href={`/members/${entry.member.id}`}
                    className="font-medium hover:underline"
                  >
                    {entry.member.lastName} {entry.member.firstName}
                  </Link>
                  <CheckInBadge checkIn={entry} />
                  <span className="text-muted-foreground">{methodText(entry.method)}</span>
                </div>
                {entry.note && <span className="text-muted-foreground">{entry.note}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
