'use client';

import type { Permission } from '@gatefit/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useStaffSession } from '@/components/staff-session';

const items: {
  href: string;
  key:
    | 'home'
    | 'reception'
    | 'members'
    | 'checkIns'
    | 'plans'
    | 'payments'
    | 'cashShift'
    | 'shop'
    | 'settings';
  exact: boolean;
  permission?: Permission;
}[] = [
  { href: '/', key: 'home', exact: true },
  { href: '/reception', key: 'reception', exact: false, permission: 'access.verify' },
  { href: '/members', key: 'members', exact: false, permission: 'members.read' },
  { href: '/check-ins', key: 'checkIns', exact: false, permission: 'access.read' },
  { href: '/plans', key: 'plans', exact: false, permission: 'plans.read' },
  { href: '/payments', key: 'payments', exact: false, permission: 'payments.read' },
  { href: '/cash-shift', key: 'cashShift', exact: false, permission: 'cash_shifts.manage' },
  { href: '/shop', key: 'shop', exact: false, permission: 'shop.sell' },
  { href: '/settings', key: 'settings', exact: false },
];

export function MainNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { permissions } = useStaffSession();

  return (
    <nav
      aria-label={t('settings')}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
    >
      {items
        .filter((item) => !item.permission || permissions.has(item.permission))
        .map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="gf-nav-link shrink-0 px-3 py-1.5 text-sm font-semibold whitespace-nowrap"
            >
              {t(item.key)}
            </Link>
          );
        })}
    </nav>
  );
}
