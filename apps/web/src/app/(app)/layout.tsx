import { roleMessageKey } from '@gatefit/i18n/config';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { LocationSelect } from '@/components/location-select';
import { MainNav } from '@/components/main-nav';
import { OrganizationNotice, SessionExpired } from '@/components/session-gate';
import { SignOutButton } from '@/components/sign-out-button';
import { StaffSessionProvider } from '@/components/staff-session';
import { isPlatformHost, requestHost } from '@/lib/host';
import { currentLocation } from '@/lib/location';
import { getSession } from '@/lib/session';

// Everything under (app) requires a staff session. Hiding pages here is a convenience:
// the API enforces authentication and permissions on every request.
export default async function AppLayout({ children }: { children: ReactNode }) {
  // The admin address hosts the platform panel, not an organization.
  if (isPlatformHost(await requestHost())) {
    redirect('/platform');
  }
  const session = await getSession();

  if (session.kind === 'unauthenticated') {
    return <SessionExpired />;
  }
  if (session.kind !== 'authenticated') {
    return <OrganizationNotice kind={session.kind} />;
  }

  const { me } = session;
  // A member session has no business in the staff panel.
  if (!me.staff) {
    redirect('/login');
  }

  const t = await getTranslations();
  const roleKey = roleMessageKey(me.staff.role);
  const location = await currentLocation(me.staff.locations);

  return (
    <StaffSessionProvider staffId={me.staff.id} permissions={me.staff.permissions}>
      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b py-3 print:hidden">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-baseline gap-3">
              <span className="text-lg font-semibold">{t('common.appName')}</span>
              <span className="text-sm text-muted-foreground">{me.organization.name}</span>
            </div>
            <MainNav />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LocationSelect locations={me.staff.locations} currentId={location?.id ?? null} />
            <span className="text-sm">
              <span className="font-medium">{me.user.phone}</span>
              <span className="text-muted-foreground">
                {' · '}
                {roleKey ? t(roleKey) : me.staff.role.name}
              </span>
            </span>
            <LocaleSwitcher />
            <SignOutButton />
          </div>
        </header>
        <main className="flex flex-1 flex-col py-8">{children}</main>
      </div>
    </StaffSessionProvider>
  );
}
