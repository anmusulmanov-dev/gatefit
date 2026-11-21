import { ORGANIZATION_WIDE_ROLES, type Permission, type SystemRole } from '@gatefit/shared';
import { type Actor, actorOf } from '../audit/audit.service';
import type { AppRequest } from './app-request';

/** The signed-in staff member making a request, as services need it. */
export interface StaffCaller {
  organizationId: string;
  actor: Actor;
  staffId: string;
  permissions: ReadonlySet<Permission>;
  /**
   * Locations whose branch data (members, check-ins) the caller may see: null for
   * organization-wide roles, otherwise the locations they are assigned to.
   */
  locationIds: readonly string[] | null;
}

/**
 * For handlers behind @RequirePermission: by the time they run, the request is
 * authenticated, scoped to an organization and made by staff. Throws if used elsewhere.
 */
export function staffCaller(req: AppRequest): StaffCaller {
  const staff = req.access?.staff;
  if (!req.organizationId || !staff) {
    throw new Error('staffCaller() needs a request authorized with @RequirePermission');
  }
  return {
    organizationId: req.organizationId,
    actor: actorOf(req),
    staffId: staff.id,
    permissions: staff.permissions,
    locationIds: isOrganizationWide(staff.role)
      ? null
      : staff.locations.map((location) => location.id),
  };
}

function isOrganizationWide(role: { name: string; isSystem: boolean }): boolean {
  return role.isSystem && ORGANIZATION_WIDE_ROLES.includes(role.name as SystemRole);
}

/** True when the caller may see branch data of the location. */
export function canSeeLocation(caller: StaffCaller, locationId: string): boolean {
  return caller.locationIds === null || caller.locationIds.includes(locationId);
}

/** True when the caller holds every permission in `needed`. */
export function holdsAll(caller: StaffCaller, needed: Iterable<string>): boolean {
  const held: ReadonlySet<string> = caller.permissions;
  for (const permission of needed) {
    if (!held.has(permission)) {
      return false;
    }
  }
  return true;
}
