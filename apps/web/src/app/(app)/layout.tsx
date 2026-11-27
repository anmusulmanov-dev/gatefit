import { roleMessageKey } from '@gatefit/i18n/config';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { LocationSelect } from '@/components/location-select';
import { MainNav } from '@/components/main-nav';
import { ModeSwitcher } from '@/components/mode-switcher';
import { OrganizationNotice, SessionExpired } from '@/components/session-gate';
import { SignOutButton } from '@/components/sign-out-button';
import { StaffSessionProvider } from '@/components/staff-session';
import { getBranding, getColorMode } from '@/lib/branding';
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
  const [mode, branding] = await Promise.all([getColorMode(), getBranding()]);

  return (
    <StaffSessionProvider staffId={me.staff.id} permissions={me.staff.permissions}>
      <div className="flex min-h-dvh flex-col">
        <header className="gf-topbar z-30 border-b md:sticky md:top-0 print:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark logoUrl={branding?.logoUrl} />
              <span className="font-heading text-lg font-extrabold tracking-tight">
                {t('common.appName')}
              </span>
              <span className="truncate text-sm font-medium opacity-75">
                {me.organization.name}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <LocationSelect locations={me.staff.locations} currentId={location?.id ?? null} />
              <span className="hidden text-sm sm:inline">
                <span className="font-medium">{me.user.phone}</span>
                <span className="opacity-75">
                  {' · '}
                  {roleKey ? t(roleKey) : me.staff.role.name}
                </span>
              </span>
              <ModeSwitcher initial={mode} />
              <LocaleSwitcher />
              <SignOutButton />
            </div>
          </div>
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <MainNav />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 animate-rise flex-col px-4 py-8">
          {children}
        </main>
      </div>
    </StaffSessionProvider>
  );
}
