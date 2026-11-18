import { RequirePermission } from '../require-permission';
import { StaffManager } from './staff-manager';

export default function StaffSettingsPage() {
  return (
    <RequirePermission permission="staff.read">
      <StaffManager />
    </RequirePermission>
  );
}
