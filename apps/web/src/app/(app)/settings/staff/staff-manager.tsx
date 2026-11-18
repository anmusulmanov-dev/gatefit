'use client';

import type { LocationDto, Page, RoleDto, StaffDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan, useStaffSession } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useRoleName } from '@/lib/role-name';
import { useApiGet } from '@/lib/use-api';

import { SectionHeader } from '../section-header';
import { StaffDialog } from './staff-dialog';

type StatusFilter = '' | 'active' | 'inactive';
type Editing = { kind: 'new' } | { kind: 'edit'; staff: StaffDto } | null;

/** Pages after the first, remembered together with the list they continue. */
interface MorePages {
  listKey: string;
  items: StaffDto[];
  nextCursor: string | null;
}

export function StaffManager() {
  const t = useTranslations();
  const roleName = useRoleName();
  const { staffId: myStaffId } = useStaffSession();
  const canManage = useCan('staff.manage');
  const [status, setStatus] = useState<StatusFilter>('');
  const [editing, setEditing] = useState<Editing>(null);
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const listPath = `/staff?limit=50${status ? `&status=${status}` : ''}`;
  const firstPage = useApiGet<Page<StaffDto>>(listPath);
  // Needed only to edit: the role list (with permissions) and the locations.
  const roles = useApiGet<RoleDto[]>('/roles');
  const locations = useApiGet<LocationDto[]>('/locations');

  const listKey = `${listPath}:${JSON.stringify(firstPage.data?.items.map((item) => item.id))}`;
  const extra = more?.listKey === listKey ? more : null;
  const items = [...(firstPage.data?.items ?? []), ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.nextCursor : (firstPage.data?.nextCursor ?? null);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const result = await api.get<Page<StaffDto>>(`${listPath}&cursor=${nextCursor}`);
    setLoadingMore(false);
    if (result.ok) {
      setMore({
        listKey,
        items: [...(extra?.items ?? []), ...result.data.items],
        nextCursor: result.data.nextCursor,
      });
    }
  }

  function reloadAll() {
    setMore(null);
    firstPage.reload();
    roles.reload();
  }

  return (
    <>
      <SectionHeader
        title={t('settings.nav.staff')}
        action={
          canManage && (
            <Button
              onClick={() => {
                setEditing({ kind: 'new' });
              }}
            >
              {t('staffSettings.add')}
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="staff-status" className="text-sm text-muted-foreground">
          {t('staffSettings.status')}
        </label>
        <Select
          id="staff-status"
          className="h-8 w-auto"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
          }}
        >
          <option value="">{t('staffSettings.allStatuses')}</option>
          <option value="active">{t('staffSettings.statusValues.active')}</option>
          <option value="inactive">{t('staffSettings.statusValues.inactive')}</option>
        </Select>
      </div>

      {firstPage.error ? (
        <LoadFailed onRetry={firstPage.reload} />
      ) : !firstPage.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>{t('staffSettings.empty')}</Empty>
      ) : (
        <>
          <ul className="flex flex-col divide-y rounded-lg border" aria-busy={firstPage.loading}>
            {items.map((staff) => (
              <li
                key={staff.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {`${staff.firstName} ${staff.lastName}`.trim() || staff.phone}
                    </span>
                    {staff.id === myStaffId && <Badge tone="muted">{t('staffSettings.you')}</Badge>}
                    {staff.status === 'inactive' && (
                      <Badge tone="muted">{t('staffSettings.statusValues.inactive')}</Badge>
                    )}
                    {staff.mustChangePassword && (
                      <Badge tone="warning">{t('staffSettings.mustChangePassword')}</Badge>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {[
                      staff.phone,
                      roleName(staff.role),
                      staff.position,
                      staff.locations.map((location) => location.name).join(', '),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={staff.totpEnabled ? 'positive' : 'muted'}>
                    {t('staffSettings.totp')}:{' '}
                    {staff.totpEnabled ? t('staffSettings.totpOn') : t('staffSettings.totpOff')}
                  </Badge>
                  {canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditing({ kind: 'edit', staff });
                      }}
                    >
                      {t('common.edit')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {t('common.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      {editing &&
        (roles.data && locations.data ? (
          <StaffDialog
            staff={editing.kind === 'edit' ? editing.staff : null}
            roles={roles.data}
            locations={locations.data}
            onClose={() => {
              setEditing(null);
            }}
            onChanged={reloadAll}
            onSaved={() => {
              setEditing(null);
              reloadAll();
            }}
          />
        ) : (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {roles.error || locations.error ? t('common.loadError') : t('common.loading')}
          </p>
        ))}
    </>
  );
}
