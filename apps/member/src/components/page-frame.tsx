import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '@/components/locale-switcher';

/**
 * The single-column phone layout shared by every screen. Sign-in and notices sit in the
 * middle; the screens of a signed-in member start at the top, above the tab bar.
 */
export async function PageFrame({
  children,
  align = 'center',
}: {
  children: ReactNode;
  align?: 'center' | 'top';
}) {
  const t = await getTranslations();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4">
      <header className="flex items-center justify-between gap-3 py-4">
        <span className="text-lg font-semibold">{t('common.appName')}</span>
        <LocaleSwitcher />
      </header>
      <main
        className={`flex flex-1 flex-col gap-6 pb-24 ${align === 'center' ? 'justify-center' : ''}`}
      >
        {children}
      </main>
    </div>
  );
}
