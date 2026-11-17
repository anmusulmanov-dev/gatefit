import type { SessionState } from '@gatefit/shared';
import { getTranslations } from 'next-intl/server';

import { PageFrame } from '@/components/page-frame';
import { SessionRecovery } from '@/components/session-recovery';

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
    <PageFrame>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1>
        <p className="text-muted-foreground">{text.body}</p>
      </div>
    </PageFrame>
  );
}

/**
 * Shown in place of a protected screen when the access token is missing or expired. The
 * browser then tries to renew the session and either reloads the screen or goes to sign-in.
 */
export function SessionExpired() {
  return (
    <PageFrame>
      <SessionRecovery />
    </PageFrame>
  );
}
