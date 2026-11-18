'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

export function Loading() {
  const t = useTranslations('common');
  return (
    <p role="status" className="py-8 text-center text-muted-foreground">
      {t('loading')}
    </p>
  );
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('common');
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-muted-foreground">{t('loadError')}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}

export function Empty({ children }: { children: string }) {
  return <p className="py-8 text-center text-muted-foreground">{children}</p>;
}
