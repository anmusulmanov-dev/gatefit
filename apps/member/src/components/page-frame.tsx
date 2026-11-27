import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ModeSwitcher } from '@/components/mode-switcher';
import { getBranding, getColorMode } from '@/lib/branding';

/**
 * The single-column phone layout shared by every screen. Sign-in and notices sit in the
 * middle; the screens of a signed-in member start at the top, above the tab bar.
 */
export async function PageFrame({
  children,
  align = 'center',
  brand = false,
}: {
  children: ReactNode;
  align?: 'center' | 'top';
  /** Show the club's brand panel above the content (sign-in). */
  brand?: boolean;
}) {
  const t = await getTranslations();
  const [branding, mode] = await Promise.all([getBranding(), getColorMode()]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <span className="flex items-center gap-2">
          <BrandMark logoUrl={branding?.logoUrl} />
          <span className="font-heading text-lg font-extrabold tracking-tight">
            {t('common.appName')}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <ModeSwitcher initial={mode} />
          <LocaleSwitcher />
        </span>
      </header>
      <main
        className={`flex flex-1 animate-rise flex-col gap-6 pb-24 ${align === 'center' ? 'justify-center' : ''}`}
      >
        {brand && (
          <div className="gf-brand-panel flex flex-col gap-1 rounded-xl px-5 py-6 shadow-card">
            {branding?.logoUrl && (
              // A light tile keeps a dark logo readable on the brand colour.
              // eslint-disable-next-line @next/next/no-img-element -- signed link from our own API
              <img
                src={branding.logoUrl}
                alt={t('orgSettings.logoAlt', { name: branding.name })}
                className="mb-2 h-14 w-auto max-w-44 self-start rounded-md bg-white object-contain p-1.5"
              />
            )}
            {branding && (
              <p className="font-heading text-xl font-extrabold tracking-tight">{branding.name}</p>
            )}
            <p className="max-w-[30ch] text-sm text-white/90">{t('member.home.subtitle')}</p>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
