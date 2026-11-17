'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { platformApi } from '@/lib/platform-api';

export function PlatformSignOut() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await platformApi.post('/auth/logout');
          router.replace('/platform/login');
          router.refresh();
        });
      }}
    >
      {t('signOut')}
    </Button>
  );
}
