'use client';

import type { MembershipDto, Page } from '@gatefit/shared';
import { useTranslations } from 'next-intl';

import { useApiGet } from '@/lib/use-api-get';

import { MembershipLine } from '../member-ui';

/** All the member's memberships, newest first (docs/TZ.md F-9.1). */
export function MembershipsList() {
  const t = useTranslations('member');
  const memberships = useApiGet<Page<MembershipDto>>('/me/memberships?limit=100');

  if (memberships.error) {
    return <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>;
  }
  if (!memberships.data) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (memberships.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('memberships.empty')}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {memberships.data.items.map((membership) => (
        <li key={membership.id} className="p-4">
          <MembershipLine membership={membership} />
        </li>
      ))}
    </ul>
  );
}
