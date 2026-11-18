import type { Locale, Messages } from '@gatefit/i18n';

// Makes translation keys and locales type-checked in useTranslations / getTranslations.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
