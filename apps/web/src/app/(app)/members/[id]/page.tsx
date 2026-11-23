import { RequirePermission } from '../../settings/require-permission';
import { memberScope } from '../member-scope';
import { MemberCard } from './member-card';

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="members.read">
      <MemberCard id={id} scope={await memberScope()} />
    </RequirePermission>
  );
}
