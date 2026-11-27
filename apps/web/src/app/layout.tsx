import { DEFAULT_THEME } from '@gatefit/shared';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { getBranding, getColorMode } from '@/lib/branding';
import { fontVariables } from '@/lib/fonts';

import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const [t, branding] = await Promise.all([getTranslations(), getBranding()]);
  return {
    title: `${t('web.home.title')} · ${t('common.appName')}`,
    description: t('web.home.subtitle'),
    // The organization's logo in the browser tab, when it has one.
    ...(branding?.logoUrl ? { icons: { icon: branding.logoUrl } } : {}),
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
      </body>
    </html>
  );
}
