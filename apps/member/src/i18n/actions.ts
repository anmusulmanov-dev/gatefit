'use server';

import { isLocale, LOCALE_COOKIE } from '@gatefit/i18n/config';
import { cookies } from 'next/headers';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Persists the chosen interface language. Unsupported values are ignored. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    return;
  }
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
  });
}
