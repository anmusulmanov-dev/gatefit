import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '../../settings/require-permission';
import { memberScope } from '../member-scope';
import { NewMember } from './new-member';

export default async function NewMemberPage() {
  const t = await getTranslations('members');
  return (
    <RequirePermission permission="members.manage">
      <h1 className="mb-6 text-2xl font-semibold">{t('new')}</h1>
      <NewMember scope={await memberScope()} />
    </RequirePermission>
  );
}
