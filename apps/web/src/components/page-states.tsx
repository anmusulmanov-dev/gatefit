'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

export function Loading() {
  const t = useTranslations('common');
  // Placeholder rows shaped like the content to come; the text is for screen readers.
  return (
    <div role="status" className="flex flex-col gap-3 py-4">
      <span className="sr-only">{t('loading')}</span>
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className="flex items-center gap-3">
          <div className="gf-skeleton size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="gf-skeleton h-3.5 w-2/5" />
            <div className="gf-skeleton h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
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
  return (
    <p className="rounded-lg border border-dashed py-10 text-center text-muted-foreground">
      {children}
    </p>
  );
}
