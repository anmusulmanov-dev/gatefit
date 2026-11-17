'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

const tones = { trial: 'warning', active: 'positive', blocked: 'muted' } as const;

export function StatusBadge({ status }: { status: 'trial' | 'active' | 'blocked' }) {
  const t = useTranslations('orgSettings.statusValues');
  return <Badge tone={tones[status]}>{t(status)}</Badge>;
}
