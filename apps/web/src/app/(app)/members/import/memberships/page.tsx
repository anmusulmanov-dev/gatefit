import { RequirePermission } from '../../../settings/require-permission';
import { MembershipImportWizard } from './membership-import-wizard';

export default function MembershipImportPage() {
  return (
    <RequirePermission permission="members.import">
      <MembershipImportWizard />
    </RequirePermission>
  );
}
