import { RequirePermission } from '../require-permission';
import { RolesManager } from './roles-manager';

export default function RolesSettingsPage() {
  return (
    <RequirePermission permission="roles.read">
      <RolesManager />
    </RequirePermission>
  );
}
