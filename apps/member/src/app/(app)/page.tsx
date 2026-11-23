import { getTranslations } from 'next-intl/server';

import { PageFrame } from '@/components/page-frame';
import { getSession } from '@/lib/session';

import { MembershipSummary } from './member-ui';
import { QrCard } from './qr-card';

export default async function HomePage() {
  const t = await getTranslations();
  const session = await getSession();
  // The layout has already turned away everyone who is not signed in.
  const me = session.kind === 'authenticated' ? session.me : null;

  return (
    <PageFrame align="top">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{me?.organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('member.home.title')}</h1>
      </div>
      <QrCard />
      <MembershipSummary />
    </PageFrame>
  );
}
