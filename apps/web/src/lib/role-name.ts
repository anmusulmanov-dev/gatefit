'use client';

import { roleMessageKey } from '@gatefit/i18n/config';
import { useTranslations } from 'next-intl';

/** Display name of a role: standard roles are translated, custom ones keep their own name. */
export function useRoleName(): (role: { name: string; isSystem: boolean }) => string {
  const t = useTranslations();
  return (role) => {
    const key = roleMessageKey(role);
    return key ? t(key) : role.name;
  };
}
