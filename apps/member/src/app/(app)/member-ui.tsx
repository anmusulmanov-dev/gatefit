'use client';

import {
  formatMinor,
  type MemberPaymentsDto,
  type MembershipDto,
  type Page,
} from '@gatefit/shared';
import { useFormatter, useLocale, useTranslations } from 'next-intl';

import { useApiGet } from '@/lib/use-api-get';

/** In force first, then the one that ends soonest: what the member holds now. */
export function currentMembership(items: readonly MembershipDto[]): MembershipDto | null {
  const rank = (item: MembershipDto) =>
    item.status === 'active'
      ? 0
      : item.status === 'frozen'
        ? 1
        : item.status === 'scheduled'
          ? 2
          : 9;
  return (
    [...items]
      .filter((item) => rank(item) < 9)
      .sort((a, b) => rank(a) - rank(b) || a.endsOn.localeCompare(b.endsOn))[0] ?? null
  );
}

export function useMoneyText() {
  const locale = useLocale();
  return (minor: string, currency: string) => formatMinor(minor, currency, locale);
}

export function useDay() {
  const format = useFormatter();
  return (value: string) =>
    // Numeric: browsers lack Uzbek month names and would print "M11".
    format.dateTime(new Date(`${value}T00:00:00Z`), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
}

/** One membership: plan, status and what is left. */
export function MembershipLine({ membership }: { membership: MembershipDto }) {
  const t = useTranslations();
  const day = useDay();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-semibold">{membership.plan.name}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-sm ${
            membership.status === 'active'
              ? 'bg-emerald-100 text-emerald-900'
              : membership.status === 'frozen' || membership.status === 'scheduled'
                ? 'bg-amber-100 text-amber-900'
                : 'border border-border text-muted-foreground'
          }`}
        >
          {t(`memberships.status.${membership.status}`)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {[
          t('memberships.period', { from: day(membership.startsOn), to: day(membership.endsOn) }),
          membership.daysLeft !== null && t('memberships.daysLeft', { count: membership.daysLeft }),
          membership.visitsLeft !== null &&
            membership.visitLimit !== null &&
            t('memberships.visitsLeft', {
              left: membership.visitsLeft,
              total: membership.visitLimit,
            }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

/** The home screen's summary: the membership held now and any debt. */
export function MembershipSummary() {
  const t = useTranslations('member');
  const money = useMoneyText();
  const memberships = useApiGet<Page<MembershipDto>>('/me/memberships?limit=20');
  const payments = useApiGet<MemberPaymentsDto>('/me/payments?limit=1');
  const current = memberships.data ? currentMembership(memberships.data.items) : null;

  return (
    <section
      aria-labelledby="membership-title"
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
    >
      <h2 id="membership-title" className="text-lg font-semibold">
        {t('home.membership')}
      </h2>
      {memberships.error ? (
        <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
      ) : !memberships.data ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : current ? (
        <MembershipLine membership={current} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('home.noMembership')}</p>
      )}
      {payments.data?.owed.map((debt) => (
        <p key={debt.currency} className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          {t('payments.owed', { amount: money(debt.amountMinor, debt.currency) })}
        </p>
      ))}
    </section>
  );
}
