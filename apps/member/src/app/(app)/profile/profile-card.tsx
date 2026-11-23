'use client';

import type { MemberProfileDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';

import { useApiGet } from '@/lib/use-api-get';

/** Who the member is, as the club has them; changes go through the front desk. */
export function ProfileCard() {
  const t = useTranslations('member');
  const profile = useApiGet<MemberProfileDto>('/me/member');

  if (profile.error) {
    return <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>;
  }
  if (!profile.data) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }
  const { data } = profile;
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <div className="flex items-center gap-4">
        {data.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link from the API
          <img src={data.photoUrl} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-full border border-border text-xl font-semibold">
            {data.lastName.charAt(0)}
            {data.firstName.charAt(0)}
          </div>
        )}
        <p className="text-xl font-semibold break-words">
          {data.lastName} {data.firstName}
        </p>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('profile.phone')}</dt>
        <dd>{data.phone}</dd>
        <dt className="text-muted-foreground">{t('profile.location')}</dt>
        <dd>{data.homeLocation.name}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">{t('profile.changeHint')}</p>
    </section>
  );
}
