import type { Permission } from '@gatefit/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { getSession } from '@/lib/session';

/** Renders a settings section only for staff holding its permission. */
export async function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const session = await getSession();
  const allowed =
    session.kind === 'authenticated' && session.me.staff?.permissions.includes(permission);
  if (allowed) {
    return children;
  }
  const t = await getTranslations('settings');
  return <p className="text-muted-foreground">{t('noAccess')}</p>;
}
