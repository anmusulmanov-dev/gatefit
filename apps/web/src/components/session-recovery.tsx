'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { api } from '@/lib/api';

/**
 * Server components cannot renew a session (they cannot set cookies), so the browser does
 * it: asking for /me makes the API client refresh an expired access token. If that works
 * the page is rendered again, now signed in; otherwise the user goes to sign-in.
 */
export function SessionRecovery() {
  const router = useRouter();
  const t = useTranslations();

  useEffect(() => {
    let cancelled = false;
    void api.get('/me').then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        router.refresh();
      } else {
        router.replace('/login');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <p role="status" className="text-center text-muted-foreground">
      {t('common.loading')}
    </p>
  );
}
