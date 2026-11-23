import { RequirePermission } from '../../settings/require-permission';
import { memberScope } from '../member-scope';
import { ImportWizard } from './import-wizard';

export default async function MemberImportPage() {
  return (
    <RequirePermission permission="members.import">
      <ImportWizard scope={await memberScope()} />
    </RequirePermission>
  );
}
