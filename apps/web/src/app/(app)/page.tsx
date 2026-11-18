import { getTranslations } from 'next-intl/server';

export default async function HomePage() {
  const t = await getTranslations();

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">{t('web.home.title')}</h1>
      <p className="text-muted-foreground">{t('web.home.subtitle')}</p>
    </div>
  );
}
