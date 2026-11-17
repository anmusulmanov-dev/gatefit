'use client';

import type { LocationDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { CheckboxRow } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import { SectionHeader } from '../section-header';
import { LocationDialog } from './location-dialog';

type Editing = { kind: 'new' } | { kind: 'edit'; location: LocationDto } | null;

export function LocationsManager() {
  const t = useTranslations();
  const canManage = useCan('locations.manage');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const locations = useApiGet<LocationDto[]>(
    `/locations${showArchived ? '?includeArchived=true' : ''}`,
  );
  const archive = useApiAction();

  function setArchived(location: LocationDto, archived: boolean) {
    archive.run(() => api.patch(`/locations/${location.id}`, { archived }), locations.reload);
  }

  return (
    <>
      <SectionHeader
        title={t('settings.nav.locations')}
        action={
          canManage && (
            <Button
              onClick={() => {
                setEditing({ kind: 'new' });
              }}
            >
              {t('locations.add')}
            </Button>
          )
        }
      />
      <CheckboxRow
        className="mb-4"
        label={t('locations.showArchived')}
        checked={showArchived}
        onChange={(event) => {
          setShowArchived(event.target.checked);
        }}
      />
      {archive.error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {archive.error}
        </p>
      )}

      {locations.error ? (
        <LoadFailed onRetry={locations.reload} />
      ) : !locations.data ? (
        <Loading />
      ) : locations.data.length === 0 ? (
        <Empty>{t('locations.empty')}</Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" aria-busy={locations.loading}>
          {locations.data.map((location) => (
            <li
              key={location.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{location.name}</span>
                  {location.archived && <Badge tone="muted">{t('locations.archived')}</Badge>}
                </div>
                <span className="text-sm text-muted-foreground">
                  {[location.address, location.timezone].filter(Boolean).join(' · ')}
                </span>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing({ kind: 'edit', location });
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={archive.pending}
                    onClick={() => {
                      setArchived(location, !location.archived);
                    }}
                  >
                    {location.archived ? t('locations.restore') : t('locations.archive')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <LocationDialog
          location={editing.kind === 'edit' ? editing.location : null}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            locations.reload();
          }}
        />
      )}
    </>
  );
}
