'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export function SignOutButton() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await api.post('/auth/logout');
          router.replace('/login');
          router.refresh();
        });
      }}
    >
      {t('auth.signOut')}
    </Button>
  );
}
