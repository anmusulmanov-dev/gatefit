import type { ReactNode } from 'react';

import { OrganizationNotice, SessionExpired } from '@/components/session-gate';
import { getSession } from '@/lib/session';

// Everything under (app) requires a member session. Hiding screens here is a convenience:
// the API enforces authentication on every request.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (session.kind === 'unauthenticated') {
    return <SessionExpired />;
  }
  if (session.kind !== 'authenticated') {
    return <OrganizationNotice kind={session.kind} />;
  }
  return children;
}
