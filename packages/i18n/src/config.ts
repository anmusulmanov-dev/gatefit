// Locale settings without the message catalogues, safe to import from client bundles.

export const locales = ['uz', 'ru', 'en'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'uz';

/** Cookie that stores the user's chosen interface language. */
export const LOCALE_COOKIE = 'gatefit_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Falls back to the default locale for missing or unsupported values. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}
