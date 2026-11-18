import { RequirePermission } from '../require-permission';
import { LocationsManager } from './locations-manager';

export default function LocationsSettingsPage() {
  return (
    <RequirePermission permission="locations.read">
      <LocationsManager />
    </RequirePermission>
  );
}
