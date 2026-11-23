import { memberScope } from '../members/member-scope';
import { RequirePermission } from '../settings/require-permission';
import { ReceptionDesk } from './reception-desk';

export default async function ReceptionPage() {
  return (
    <RequirePermission permission="access.verify">
      <ReceptionDesk scope={await memberScope()} />
    </RequirePermission>
  );
}
