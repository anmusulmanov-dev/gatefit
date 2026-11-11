import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';

export default async function HomePage() {
  const t = await getTranslations();

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <span className="text-lg font-semibold">{t('common.appName')}</span>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col justify-center gap-2 pb-24">
        <h1 className="text-3xl font-semibold tracking-tight">{t('web.home.title')}</h1>
        <p className="text-muted-foreground">{t('web.home.subtitle')}</p>
      </main>
    </div>
  );
}
