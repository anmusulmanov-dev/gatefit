import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { PageFrame } from '@/components/page-frame';
import { SignOutButton } from '@/components/sign-out-button';

import { ProfileCard } from './profile-card';

export default async function ProfilePage() {
  const t = await getTranslations();
  return (
    <PageFrame align="top">
      <h1 className="text-2xl font-semibold tracking-tight">{t('member.profile.title')}</h1>
      <ProfileCard />
      <label className="flex flex-col gap-2 text-sm font-medium">
        {t('common.language')}
        <LocaleSwitcher />
      </label>
      <SignOutButton />
    </PageFrame>
  );
}
