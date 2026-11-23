import { getTranslations } from 'next-intl/server';

import { PageFrame } from '@/components/page-frame';

import { MembershipsList } from './memberships-list';

export default async function MembershipsPage() {
  const t = await getTranslations('member');
  return (
    <PageFrame align="top">
      <h1 className="text-2xl font-semibold tracking-tight">{t('memberships.title')}</h1>
      <MembershipsList />
    </PageFrame>
  );
}
