import { RequirePermission } from '../settings/require-permission';
import { memberScope } from '../members/member-scope';
import { CashShiftDesk } from './cash-shift-desk';

export default async function CashShiftPage() {
  return (
    <RequirePermission permission="cash_shifts.manage">
      <CashShiftDesk scope={await memberScope()} />
    </RequirePermission>
  );
}
