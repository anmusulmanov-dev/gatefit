import type { Permission } from '@gatefit/shared';
import { type Actor, actorOf } from '../audit/audit.service';
import type { AppRequest } from './app-request';

/** The signed-in staff member making a request, as services need it. */
export interface StaffCaller {
  organizationId: string;
  actor: Actor;
  staffId: string;
  permissions: ReadonlySet<Permission>;
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
  };
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
