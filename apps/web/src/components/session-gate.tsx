import type { SessionState } from '@gatefit/shared';
import { getTranslations } from 'next-intl/server';

import { CenteredPage } from '@/components/centered-page';
import { SessionRecovery } from '@/components/session-recovery';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Blocked = Exclude<SessionState, { kind: 'authenticated' } | { kind: 'unauthenticated' }>;

/** Explains why nothing can be shown at this address. */
export async function OrganizationNotice({ kind }: { kind: Blocked['kind'] }) {
  const t = await getTranslations('organization');
  const text = {
    'no-organization': { title: t('missingTitle'), body: t('missingText') },
    'organization-blocked': { title: t('blockedTitle'), body: t('blockedText') },
    unavailable: { title: t('unavailableTitle'), body: t('unavailableText') },
  }[kind];

  return (
    <CenteredPage>
      <Card>
        <CardHeader>
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>{text.body}</CardDescription>
        </CardHeader>
      </Card>
    </CenteredPage>
  );
}

/**
 * Shown in place of a protected page when the access token is missing or expired. The
 * browser then tries to renew the session and either reloads the page or goes to sign-in.
 */
export function SessionExpired() {
  return (
    <CenteredPage>
      <SessionRecovery />
    </CenteredPage>
  );
}
