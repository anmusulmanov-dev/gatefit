import { getTranslations } from 'next-intl/server';

import { PageFrame } from '@/components/page-frame';
import { SignOutButton } from '@/components/sign-out-button';
import { getSession } from '@/lib/session';

export default async function HomePage() {
  const t = await getTranslations();
  const session = await getSession();
  // The layout has already turned away everyone who is not signed in.
  const me = session.kind === 'authenticated' ? session.me : null;

  return (
    <PageFrame>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{me?.organization.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('member.home.title')}</h1>
        <p className="text-muted-foreground">{t('member.home.subtitle')}</p>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-center font-medium">{me?.user.phone}</p>
        <SignOutButton />
      </div>
    </PageFrame>
  );
}
