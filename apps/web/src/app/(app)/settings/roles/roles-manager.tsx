'use client';

import type { RoleDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

// Standard roles always exist, so the list is never empty.
import { LoadFailed, Loading } from '@/components/page-states';
import { useCan, useHoldsAll } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRoleName } from '@/lib/role-name';
import { useApiGet } from '@/lib/use-api';

import { SectionHeader } from '../section-header';
import { RoleDialog } from './role-dialog';

type Open = { kind: 'new' } | { kind: 'existing'; role: RoleDto } | null;

export function RolesManager() {
  const t = useTranslations();
  const roleName = useRoleName();
  const canManage = useCan('roles.manage');
  const holdsAll = useHoldsAll();
  const roles = useApiGet<RoleDto[]>('/roles');
  const [open, setOpen] = useState<Open>(null);

  return (
    <>
      <SectionHeader
        title={t('settings.nav.roles')}
        action={
          canManage && (
            <Button
              onClick={() => {
                setOpen({ kind: 'new' });
              }}
            >
              {t('rolesSettings.add')}
            </Button>
          )
        }
      />

      {roles.error ? (
        <LoadFailed onRetry={roles.reload} />
      ) : !roles.data ? (
        <Loading />
      ) : (
        <ul
          className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50"
          aria-busy={roles.loading}
        >
          {roles.data.map((role) => {
            // Editing needs the right and every permission the role grants (as the API checks).
            const editable = canManage && !role.isSystem && holdsAll(role.permissions);
            return (
              <li
                key={role.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{roleName(role)}</span>
                    {role.isSystem && <Badge>{t('rolesSettings.system')}</Badge>}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {t('rolesSettings.staffCount', { count: role.staffCount })}
                    {' · '}
                    {t('rolesSettings.permissionCount', { count: role.permissions.length })}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOpen({ kind: 'existing', role });
                  }}
                >
                  {editable ? t('common.edit') : t('rolesSettings.view')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <RoleDialog
          role={open.kind === 'existing' ? open.role : null}
          editable={
            open.kind === 'new' ||
            (canManage && !open.role.isSystem && holdsAll(open.role.permissions))
          }
          onClose={() => {
            setOpen(null);
          }}
          onSaved={() => {
            setOpen(null);
            roles.reload();
          }}
        />
      )}
    </>
  );
}
