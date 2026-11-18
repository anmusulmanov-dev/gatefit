import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { getSession } from '@/lib/session';

import { SettingsNav } from './settings-nav';
import { visibleSections } from './sections';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('settings');
  const session = await getSession();
  // The (app) layout has already turned away everyone who is not signed-in staff.
  const permissions = session.kind === 'authenticated' ? (session.me.staff?.permissions ?? []) : [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <SettingsNav sections={visibleSections(permissions)} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
