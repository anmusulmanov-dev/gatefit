'use client';

import { locales } from '@gatefit/i18n/config';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { setLocale } from '@/i18n/actions';

// A native select: the most comfortable control on a phone.
export function LocaleSwitcher() {
  const t = useTranslations();
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label={t('common.language')}
      className="h-11 rounded-md border border-border bg-card px-3 text-base"
      value={current}
      disabled={pending}
      onChange={(event) => {
        const locale = event.target.value;
        startTransition(async () => {
          await setLocale(locale);
          router.refresh();
        });
      }}
    >
      {locales.map((locale) => (
        <option key={locale} value={locale} lang={locale}>
          {t(`languages.${locale}`)}
        </option>
      ))}
    </select>
  );
}
