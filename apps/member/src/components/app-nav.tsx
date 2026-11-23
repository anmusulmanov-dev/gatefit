'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

const items = [
  { href: '/', key: 'home' },
  { href: '/memberships', key: 'memberships' },
  { href: '/payments', key: 'payments' },
  { href: '/profile', key: 'profile' },
] as const;

/** The bottom tab bar of the member app, within thumb reach. */
export function AppNav() {
  const t = useTranslations('member.nav');
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('label')}
      className="fixed inset-x-0 bottom-0 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-14 items-center justify-center px-1 text-center text-sm ${
                  active ? 'font-semibold text-foreground' : 'text-muted-foreground'
                }`}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
