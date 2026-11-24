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
        className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center text-muted-foreground"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-3 rounded-full bg-primary',
            pending ? 'animate-ping' : 'animate-live shadow-[0_0_0_0_var(--primary)]',
          )}
        />
        {pending ? t('checking') : t('waiting')}
      </div>
    );
  }

  const { member, membership } = result;
  const initials = member ? `${member.lastName.charAt(0)}${member.firstName.charAt(0)}` : '?';
  return (
    <div
      // A new key per answer replays the entrance, so a repeat scan is noticed too.
      key={result.checkInId ?? `${result.allowed}-${member?.id ?? ''}-${result.reason ?? ''}`}
      role="status"
      aria-live="assertive"
      className={cn(
        'relative flex flex-col gap-4 overflow-hidden rounded-lg p-6 shadow-raised',
        result.allowed
          ? 'animate-pop bg-ok text-ok-foreground shadow-[0_20px_50px_-20px_var(--ok)]'
          : 'animate-shake bg-no text-no-foreground shadow-[0_20px_50px_-20px_var(--no)]',
        pending && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="relative grid size-14 shrink-0 place-items-center rounded-full bg-white/20 after:absolute after:inset-0 after:animate-ring after:rounded-full after:border-2 after:border-white/60"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d={result.allowed ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 6l12 12M18 6L6 18'}
              strokeDasharray="40"
              className="animate-draw"
            />
          </svg>
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
            {result.allowed ? t('allowed') : t('denied')}
          </p>
          {result.reason && <p className="text-xl font-semibold">{reason(result.reason)}</p>}
        </div>
      </div>
      {result.repeat && <p className="text-sm font-medium">{t('repeat')}</p>}
      {offline && result.checkInId !== null && (
        <p className="text-sm font-medium">{t('offline.decided')}</p>
      )}
      {member && (
        <div className="flex items-center gap-4 rounded-md bg-black/15 p-3">
          {member.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link from the API
            <img
              src={member.photoUrl}
              alt=""
              className="size-24 shrink-0 rounded-md object-cover ring-2 ring-white/40"
            />
          ) : (
            <div className="flex size-24 shrink-0 items-center justify-center rounded-md bg-white/20 text-3xl font-bold">
              {initials}
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-2xl font-bold break-words">
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
