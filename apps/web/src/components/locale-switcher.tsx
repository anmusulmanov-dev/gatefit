'use client';

import { locales } from '@gatefit/i18n/config';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { setLocale } from '@/i18n/actions';

export function LocaleSwitcher() {
  const t = useTranslations();
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="group" aria-label={t('common.language')} className="flex gap-1">
      {locales.map((locale) => (
        <Button
          key={locale}
          size="sm"
          variant={locale === current ? 'default' : 'outline'}
          aria-pressed={locale === current}
          lang={locale}
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await setLocale(locale);
              router.refresh();
            });
          }}
        >
          {t(`languages.${locale}`)}
        </Button>
      ))}
    </div>
  );
}
