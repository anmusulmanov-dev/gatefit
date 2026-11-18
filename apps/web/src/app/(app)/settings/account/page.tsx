import { getTranslations } from 'next-intl/server';

import { SectionHeader } from '../section-header';
import { ChangePasswordForm } from './change-password-form';

export default async function AccountSettingsPage() {
  const t = await getTranslations();
  return (
    <>
      <SectionHeader title={t('settings.nav.account')} />
      <ChangePasswordForm />
    </>
  );
}
