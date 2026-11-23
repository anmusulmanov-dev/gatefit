'use client';

import type { AccessResultDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import { useCalendarDate } from '../plans/plan-ui';
import { useReasonText } from './access-ui';

/** The answer to the last scan, big enough to read from across the desk. */
export function ResultCard({
  result,
  pending,
  offline = false,
}: {
  result: AccessResultDto | null;
  pending: boolean;
  /** Decided by the screen without the API; sent when the internet is back. */
  offline?: boolean;
}) {
  const t = useTranslations('access');
  const reason = useReasonText();
  const date = useCalendarDate();

  if (!result) {
    return (
      <div
        className="flex min-h-48 items-center justify-center rounded-xl border border-dashed p-6 text-center text-muted-foreground"
        aria-live="polite"
      >
        {pending ? t('checking') : t('waiting')}
      </div>
    );
  }

  const { member, membership } = result;
  const initials = member ? `${member.lastName.charAt(0)}${member.firstName.charAt(0)}` : '?';
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        'flex flex-col gap-4 rounded-xl border-2 p-6',
        result.allowed
          ? 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50'
          : 'border-red-500 bg-red-50 text-red-950 dark:bg-red-950 dark:text-red-50',
        pending && 'opacity-60',
      )}
    >
      <p className="text-3xl font-bold tracking-tight">
        {result.allowed ? t('allowed') : t('denied')}
      </p>
      {result.reason && <p className="text-xl font-semibold">{reason(result.reason)}</p>}
      {result.repeat && <p className="text-sm">{t('repeat')}</p>}
      {offline && result.checkInId !== null && <p className="text-sm">{t('offline.decided')}</p>}
      {member && (
        <div className="flex items-center gap-4">
          {member.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link from the API
            <img
              src={member.photoUrl}
              alt=""
              className="size-24 shrink-0 rounded-lg border object-cover"
            />
          ) : (
            <div className="flex size-24 shrink-0 items-center justify-center rounded-lg border bg-background/60 text-3xl font-semibold">
              {initials}
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-2xl font-semibold break-words">
              {member.lastName} {member.firstName}
            </p>
            {membership && (
              <p className="text-base">
                {[
                  membership.planName,
                  t('until', { date: date(membership.endsOn) }),
                  membership.daysLeft !== null && t('daysLeft', { count: membership.daysLeft }),
                  membership.visitsLeft !== null &&
                    t('visitsLeft', { count: membership.visitsLeft }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
