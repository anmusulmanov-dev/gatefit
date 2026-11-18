'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

const items = ['organizations', 'plans'] as const;

export function PlatformNav() {
  const t = useTranslations('platform');
  const pathname = usePathname();

  return (
    <nav aria-label={t('title')} className="flex gap-1">
      {items.map((item) => {
        const href = `/platform/${item}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={item}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              active && 'bg-accent text-accent-foreground',
            )}
          >
            {t(`nav.${item}`)}
          </Link>
        );
      })}
    </nav>
  );
}
