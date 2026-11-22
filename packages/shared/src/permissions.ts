import type { SystemRole } from './roles';

/**
 * Every permission the API can check. Format: `<area>.<action>`.
 * Organizations build their own roles from this list; standard roles are defined below.
 */
export const PERMISSIONS = [
  'organization.read',
  'organization.update',
  'locations.read',
  'locations.manage',
  'staff.read',
  'staff.manage',
  'roles.read',
  'roles.manage',
  'members.read',
  'members.manage',
  'members.import',
  'members.export',
  'members.archive',
  'plans.read',
  'plans.manage',
  'memberships.sell',
  'memberships.freeze',
  'memberships.cancel',
  'access.verify',
  'access.manual',
  'access.read',
  'payments.read',
  'payments.accept',
  'payments.refund',
  'cash_shifts.manage',
  'reports.daily',
  'reports.financial',
  'notifications.manage',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Permissions of the standard roles (docs/TZ.md section 2). The owner holds everything. */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: [
    'organization.read',
    'locations.read',
    'staff.read',
    'roles.read',
    'members.read',
    'members.manage',
    'members.import',
    'members.export',
    'members.archive',
    'plans.read',
    'memberships.sell',
    'memberships.freeze',
    'memberships.cancel',
    'access.verify',
    'access.manual',
    'access.read',
    'payments.read',
    'payments.accept',
    'cash_shifts.manage',
    'reports.daily',
    'notifications.manage',
  ],
  receptionist: [
    'organization.read',
    'locations.read',
    'members.read',
    'members.manage',
    'plans.read',
    'memberships.sell',
    'memberships.freeze',
    'access.verify',
    'access.manual',
    'access.read',
    'payments.read',
    'payments.accept',
    'cash_shifts.manage',
  ],
  trainer: ['organization.read', 'locations.read', 'members.read', 'access.read'],
  accountant: [
    'organization.read',
    'locations.read',
    'members.read',
    'members.export',
    'plans.read',
    'payments.read',
    'payments.refund',
    'reports.daily',
    'reports.financial',
    'audit.read',
  ],
};

/** Standard roles that must sign in with a second factor (docs/TZ.md section 7). */
export const TOTP_REQUIRED_ROLES: readonly SystemRole[] = ['owner', 'accountant'];
