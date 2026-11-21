import { RequirePermission } from '../settings/require-permission';
import { PlansManager } from './plans-manager';

export default function PlansPage() {
  return (
    <RequirePermission permission="plans.read">
      <PlansManager />
    </RequirePermission>
  );
}
