import { getTranslations } from 'next-intl/server';

import { getSession } from '@/lib/session';

import { DailyReport } from './daily-report';
import { memberScope } from './members/member-scope';

export default async function HomePage() {
  const t = await getTranslations();
  const session = await getSession();
  const canReport =
    session.kind === 'authenticated' &&
    (session.me.staff?.permissions.includes('reports.daily') ?? false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">{t('web.home.title')}</h1>
        {!canReport && <p className="text-muted-foreground">{t('web.home.subtitle')}</p>}
      </div>
      {canReport && <DailyReport scope={await memberScope()} />}
    </div>
  );
}
