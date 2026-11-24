import { DEFAULT_THEME, THEME_COLORS } from '@gatefit/shared';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ServiceWorker } from '@/components/service-worker';
import { getBranding, getColorMode } from '@/lib/branding';
import { fontVariables } from '@/lib/fonts';

import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: `${t('member.home.title')} · ${t('common.appName')}`,
    description: t('member.home.subtitle'),
    appleWebApp: { capable: true, title: t('common.appName') },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getBranding();
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor: THEME_COLORS[branding?.theme ?? DEFAULT_THEME],
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, branding, mode] = await Promise.all([getLocale(), getBranding(), getColorMode()]);

  return (
    <html
      lang={locale}
      data-theme={branding?.theme ?? DEFAULT_THEME}
      data-mode={mode}
      className={fontVariables}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
