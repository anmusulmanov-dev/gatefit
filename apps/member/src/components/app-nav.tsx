'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

const items: {
  href: string;
  key: 'home' | 'memberships' | 'payments' | 'profile';
  icon: ReactNode;
}[] = [
  {
    href: '/',
    key: 'home',
    icon: <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 8h3v3H8zM13 13h3v3h-3z" />,
  },
  { href: '/memberships', key: 'memberships', icon: <path d="M3 7h18v10H3zM3 11h18M7 15h4" /> },
  { href: '/payments', key: 'payments', icon: <path d="M4 6h16v12H4zM16 12h.01M4 9h16" /> },
  {
    href: '/profile',
    key: 'profile',
    icon: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />,
  },
];

/** The bottom tab bar of the member app, within thumb reach. */
export function AppNav() {
  const t = useTranslations('member.nav');
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('label')}
      className="fixed inset-x-0 bottom-0 border-t border-border bg-card/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`group flex h-16 flex-col items-center justify-center gap-1 px-1 text-center text-xs transition-colors ${
                  active ? 'font-semibold text-brand-ink' : 'text-muted-foreground'
                }`}
              >
                <span
                  className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${
                    active ? 'bg-brand-soft' : 'group-hover:bg-muted'
                  }`}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {item.icon}
                  </svg>
                </span>
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
