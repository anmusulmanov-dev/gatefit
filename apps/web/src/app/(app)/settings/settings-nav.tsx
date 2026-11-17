'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import type { SettingsSection } from './sections';

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const t = useTranslations('settings');
  const pathname = usePathname();

  return (
    <nav aria-label={t('title')} className="md:w-48 md:shrink-0">
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {sections.map((section) => {
          const href = `/settings/${section}`;
          const active = pathname.startsWith(href);
          return (
            <li key={section}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  active && 'bg-accent font-medium text-accent-foreground',
                )}
              >
                {t(`nav.${section}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
