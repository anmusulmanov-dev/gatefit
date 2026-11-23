'use client';

import type { Permission } from '@gatefit/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useStaffSession } from '@/components/staff-session';
import { cn } from '@/lib/utils';

const items: {
  href: string;
  key: 'home' | 'members' | 'plans' | 'payments' | 'cashShift' | 'settings';
  exact: boolean;
  permission?: Permission;
}[] = [
  { href: '/', key: 'home', exact: true },
  { href: '/members', key: 'members', exact: false, permission: 'members.read' },
  { href: '/plans', key: 'plans', exact: false, permission: 'plans.read' },
  { href: '/payments', key: 'payments', exact: false, permission: 'payments.read' },
  { href: '/cash-shift', key: 'cashShift', exact: false, permission: 'cash_shifts.manage' },
  { href: '/settings', key: 'settings', exact: false },
];

export function MainNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { permissions } = useStaffSession();

  return (
    <nav aria-label={t('settings')} className="flex gap-1">
      {items
        .filter((item) => !item.permission || permissions.has(item.permission))
        .map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                active && 'bg-accent text-accent-foreground',
              )}
            >
              {t(item.key)}
            </Link>
          );
        })}
    </nav>
  );
}
