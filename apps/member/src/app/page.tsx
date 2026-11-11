import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';

export default async function HomePage() {
  const t = await getTranslations();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4">
      <header className="flex items-center justify-between gap-3 py-4">
        <span className="text-lg font-semibold">{t('common.appName')}</span>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col justify-center gap-2 pb-24">
        <h1 className="text-2xl font-semibold tracking-tight">{t('member.home.title')}</h1>
        <p className="text-muted-foreground">{t('member.home.subtitle')}</p>
      </main>
    </div>
  );
}
