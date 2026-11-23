import { memberScope } from '../members/member-scope';
import { RequirePermission } from '../settings/require-permission';
import { CheckInsJournal } from './check-ins-journal';

export default async function CheckInsPage() {
  return (
    <RequirePermission permission="access.read">
      <CheckInsJournal scope={await memberScope()} />
    </RequirePermission>
  );
}
