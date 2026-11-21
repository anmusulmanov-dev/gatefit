/** Standard roles created with every organization. Organizations may add their own. */
export const SYSTEM_ROLES = ['owner', 'manager', 'receptionist', 'trainer', 'accountant'] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

/**
 * Standard roles that work across the whole organization (docs/TZ.md section 2). Every
 * other role, custom ones included, sees branch data only for the locations its holder is
 * assigned to.
 */
export const ORGANIZATION_WIDE_ROLES: readonly SystemRole[] = ['owner', 'accountant'];
