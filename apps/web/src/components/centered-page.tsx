import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { ModeSwitcher } from '@/components/mode-switcher';
import { getBranding, getColorMode } from '@/lib/branding';

/**
 * Frame for pages shown before sign-in: the organization's brand panel (beside the content
 * on wide screens, a banner above it on phones), language and light/dark on top.
 */
export async function CenteredPage({ children }: { children: ReactNode }) {
  const t = await getTranslations();
  const [branding, mode] = await Promise.all([getBranding(), getColorMode()]);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="gf-brand-panel flex flex-col justify-end gap-2 px-6 py-6 lg:w-[42%] lg:max-w-xl lg:p-12">
        <div className="flex items-center gap-3">
          {branding?.logoUrl ? (
            // A light tile keeps a dark logo readable on the brand colour.
            // eslint-disable-next-line @next/next/no-img-element -- signed link from our own API
            <img
              src={branding.logoUrl}
              alt={t('orgSettings.logoAlt', { name: branding.name })}
              className="h-12 w-auto max-w-40 rounded-md bg-white object-contain p-1.5 shadow-card"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-md bg-white/20 font-heading text-lg font-extrabold"
            >
              G
            </span>
          )}
          <span className="font-heading text-xl font-extrabold tracking-tight lg:text-2xl">
            {t('common.appName')}
          </span>
        </div>
        {branding && <p className="text-base font-semibold lg:text-lg">{branding.name}</p>}
        <p className="max-w-sm text-sm text-white/90 lg:text-base">{t('web.home.subtitle')}</p>
      </aside>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4">
        <header className="flex flex-wrap items-center justify-end gap-3 py-4">
          <ModeSwitcher initial={mode} />
          <LocaleSwitcher />
        </header>
        <main className="flex flex-1 animate-rise flex-col justify-center pb-16">{children}</main>
      </div>
    </div>
  );
}
