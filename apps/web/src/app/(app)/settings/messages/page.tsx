import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '../require-permission';
import { SectionHeader } from '../section-header';
import { TemplatesEditor } from './templates-editor';

export default async function MessagesSettingsPage() {
  const t = await getTranslations('settings.nav');
  return (
    <RequirePermission permission="notifications.manage">
      <SectionHeader title={t('messages')} />
      <TemplatesEditor />
    </RequirePermission>
  );
}
