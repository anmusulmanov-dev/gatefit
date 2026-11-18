import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '../require-permission';
import { SectionHeader } from '../section-header';
import { OrganizationForm } from './organization-form';

export default async function OrganizationSettingsPage() {
  const t = await getTranslations('settings.nav');
  return (
    <RequirePermission permission="organization.read">
      <SectionHeader title={t('organization')} />
      <OrganizationForm />
    </RequirePermission>
  );
}
