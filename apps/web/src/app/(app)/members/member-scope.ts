import { ORGANIZATION_WIDE_ROLES, type SystemRole } from '@gatefit/shared';

import { currentLocation } from '@/lib/location';
import { getSession } from '@/lib/session';

/** Which locations' members the signed-in staff member works with (docs/ADR/0006). */
export interface MemberScope {
  /** Owner and accountant see every location; others only their own. */
  organizationWide: boolean;
  /** The staff member's own locations. */
  locationIds: string[];
  /** The location chosen in the header: the default for new members. */
  currentLocationId: string | null;
}

export async function memberScope(): Promise<MemberScope> {
  const session = await getSession();
  const staff = session.kind === 'authenticated' ? session.me.staff : null;
  if (!staff) {
    return { organizationWide: false, locationIds: [], currentLocationId: null };
  }
  const location = await currentLocation(staff.locations);
  return {
    organizationWide:
      staff.role.isSystem && ORGANIZATION_WIDE_ROLES.includes(staff.role.name as SystemRole),
    locationIds: staff.locations.map((item) => item.id),
    currentLocationId: location?.id ?? null,
  };
}
