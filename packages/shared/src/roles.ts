/** Standard roles created with every organization. Organizations may add their own. */
export const SYSTEM_ROLES = ['owner', 'manager', 'receptionist', 'trainer', 'accountant'] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];
