'use client';

import type { Permission } from '@gatefit/shared';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

interface StaffSession {
  staffId: string;
  permissions: ReadonlySet<string>;
}

const StaffSessionContext = createContext<StaffSession | null>(null);

/**
 * The signed-in staff member, for client components that adapt the screen to what the
 * user may do. Hiding a button is a convenience only: the API checks every request.
 */
export function StaffSessionProvider({
  staffId,
  permissions,
  children,
}: {
  staffId: string;
  permissions: Permission[];
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ staffId, permissions: new Set<string>(permissions) }),
    [staffId, permissions],
  );
  return <StaffSessionContext.Provider value={value}>{children}</StaffSessionContext.Provider>;
}

export function useStaffSession(): StaffSession {
  const session = useContext(StaffSessionContext);
  if (!session) {
    throw new Error('useStaffSession() must be used inside StaffSessionProvider');
  }
  return session;
}

/** True when the signed-in staff member holds every given permission. */
export function useCan(...needed: Permission[]): boolean {
  const { permissions } = useStaffSession();
  return needed.every((permission) => permissions.has(permission));
}

/** True when the signed-in staff member holds every permission in the list. */
export function useHoldsAll(): (permissions: Iterable<string>) => boolean {
  const { permissions } = useStaffSession();
  return (needed) => {
    for (const permission of needed) {
      if (!permissions.has(permission)) {
        return false;
      }
    }
    return true;
  };
}
