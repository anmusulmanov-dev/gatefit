import { RequirePermission } from '../settings/require-permission';
import { memberScope } from './member-scope';
import { MembersList } from './members-list';

export default async function MembersPage() {
  return (
    <RequirePermission permission="members.read">
      <MembersList scope={await memberScope()} />
    </RequirePermission>
  );
}
