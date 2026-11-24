'use client';

import type { AccessDenyReason, CheckInDto, CheckInMethod } from '@gatefit/shared';
import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

/** Why entry was refused, in words. */
export function useReasonText() {
  const t = useTranslations('access.reasons');
  return (reason: AccessDenyReason) => t(reason);
}

export function useMethodText() {
  const t = useTranslations('access.methods');
  return (method: CheckInMethod) => t(method);
}

/** Allowed in, allowed out, or refused with the reason. */
export function CheckInBadge({ checkIn }: { checkIn: CheckInDto }) {
  const t = useTranslations('access');
  const reason = useReasonText();
  if (checkIn.result === 'denied') {
    return (
      <Badge tone="negative">{checkIn.denyReason ? reason(checkIn.denyReason) : t('denied')}</Badge>
    );
  }
  return checkIn.direction === 'out' ? (
    <Badge tone="muted">{t('out')}</Badge>
  ) : (
    <Badge tone="positive">{t('in')}</Badge>
  );
}

export function useCheckInTime() {
  const format = useFormatter();
  return (checkIn: CheckInDto, withDate = false) =>
    format.dateTime(
      new Date(checkIn.at),
      withDate ? { dateStyle: 'short', timeStyle: 'short' } : { timeStyle: 'short' },
    );
}
