'use client';

import {
  type DurationUnit,
  formatMinor,
  type PlanDto,
  type PlanFreeze,
  type PlanRestrictions,
  type PlanType,
} from '@gatefit/shared';
import { useFormatter, useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

/** Translation key of an ISO weekday (1 Monday ... 7 Sunday). */
export const weekdayKey = (day: number) => String(day) as '1' | '2' | '3' | '4' | '5' | '6' | '7';

export function PlanTypeBadge({ type }: { type: PlanType }) {
  const t = useTranslations('plans.types');
  return <Badge tone="neutral">{t(type)}</Badge>;
}

/** "1 month", "12 days". */
export function useTermText() {
  const t = useTranslations('plans.units');
  return (value: number, unit: DurationUnit) => t(unit, { count: value });
}

/** Money of a plan or membership, in the reader's locale. */
export function useMoney() {
  const locale = useLocale();
  return (minor: string, currency: string) => formatMinor(minor, currency, locale);
}

/** A calendar date (`YYYY-MM-DD`) as the reader writes dates; no time zone shift. */
export function useCalendarDate() {
  const format = useFormatter();
  return (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
}

/** One line per restriction that applies; empty when the plan has none. */
export function useRestrictionLines() {
  const t = useTranslations('plans');
  return (restrictions: PlanRestrictions, locationNames: Map<string, string>): string[] => {
    const lines: string[] = [];
    if (restrictions.timeWindows.length > 0) {
      lines.push(
        restrictions.timeWindows.map((window) => `${window.from}–${window.to}`).join(', '),
      );
    }
    if (restrictions.weekdays.length > 0 && restrictions.weekdays.length < 7) {
      lines.push(restrictions.weekdays.map((day) => t(`weekdays.${weekdayKey(day)}`)).join(', '));
    }
    if (restrictions.dailyVisitLimit !== null) {
      lines.push(t('summary.perDay', { count: restrictions.dailyVisitLimit }));
    }
    if (restrictions.locationIds.length > 0) {
      lines.push(restrictions.locationIds.map((id) => locationNames.get(id) ?? '?').join(', '));
    }
    return lines;
  };
}

export function useFreezeText() {
  const t = useTranslations('plans.summary');
  const money = useMoney();
  return (freeze: PlanFreeze, currency: string) =>
    freeze.maxDays === 0 || freeze.maxTimes === 0
      ? t('noFreeze')
      : freeze.feeMinor === '0'
        ? t('freezeFree', { days: freeze.maxDays, times: freeze.maxTimes })
        : t('freeze', {
            days: freeze.maxDays,
            times: freeze.maxTimes,
            fee: money(freeze.feeMinor, currency),
          });
}

/** The parts of a plan a list row shows, joined with " · ". */
export function usePlanSummary() {
  const t = useTranslations('plans.summary');
  const term = useTermText();
  const money = useMoney();
  return (
    plan: Pick<
      PlanDto,
      'durationValue' | 'durationUnit' | 'visitLimit' | 'priceMinor' | 'currency'
    >,
  ) =>
    [
      money(plan.priceMinor, plan.currency),
      term(plan.durationValue, plan.durationUnit),
      plan.visitLimit === null ? t('unlimitedVisits') : t('visits', { count: plan.visitLimit }),
    ].join(' · ');
}
