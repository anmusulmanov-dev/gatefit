import { RequirePermission } from '../settings/require-permission';
import { memberScope } from '../members/member-scope';
import { PaymentsJournal } from './payments-journal';

export default async function PaymentsPage() {
  return (
    <RequirePermission permission="payments.read">
      <PaymentsJournal scope={await memberScope()} />
    </RequirePermission>
  );
}
