import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '@/components/locale-switcher';

/** The single-column phone layout shared by every screen. */
export async function PageFrame({ children }: { children: ReactNode }) {
  const t = await getTranslations();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4">
      <header className="flex items-center justify-between gap-3 py-4">
        <span className="text-lg font-semibold">{t('common.appName')}</span>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col justify-center gap-6 pb-24">{children}</main>
    </div>
  );
}
