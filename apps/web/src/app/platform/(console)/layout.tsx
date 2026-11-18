import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { OrganizationNotice } from '@/components/session-gate';
import { getPlatformSession } from '@/lib/platform-session';

import { PlatformNav } from './platform-nav';
import { PlatformSignOut } from './platform-sign-out';

export default async function PlatformConsoleLayout({ children }: { children: ReactNode }) {
  const session = await getPlatformSession();
  if (session.kind === 'unauthenticated') {
    redirect('/platform/login');
  }
  if (session.kind === 'unavailable') {
    return <OrganizationNotice kind="unavailable" />;
  }

  const t = await getTranslations();
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-lg font-semibold">{t('platform.title')}</span>
          <PlatformNav />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            <span className="font-medium">{session.me.name}</span>
            <span className="text-muted-foreground"> · {session.me.phone}</span>
          </span>
          <LocaleSwitcher />
          <PlatformSignOut />
        </div>
      </header>
      <main className="flex flex-1 flex-col py-8">{children}</main>
    </div>
  );
}
