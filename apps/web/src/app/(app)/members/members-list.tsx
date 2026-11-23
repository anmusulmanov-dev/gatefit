'use client';

import {
  MEMBER_STATUSES,
  type MemberListItemDto,
  type MemberStatus,
  type Page,
} from '@gatefit/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import type { MemberScope } from './member-scope';
import {
  fullName,
  MemberAvatar,
  MemberStatusBadge,
  saveFile,
  useMemberLocations,
} from './member-ui';

const SEARCH_DELAY_MS = 300;

/** Pages after the first, remembered together with the list they continue. */
interface MorePages {
  listKey: string;
  items: MemberListItemDto[];
  nextCursor: string | null;
}

export function MembersList({ scope }: { scope: MemberScope }) {
  const t = useTranslations();
  const canManage = useCan('members.manage');
  const canImport = useCan('members.import');
  const canExport = useCan('members.export');
  const locations = useMemberLocations(scope);
  const exporting = useApiAction();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<MemberStatus | ''>('');
  const [locationId, setLocationId] = useState('');
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search as the user types, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const filters = new URLSearchParams();
  if (query) filters.set('q', query);
  if (status) filters.set('status', status);
  if (locationId) filters.set('locationId', locationId);
  const filterString = filters.toString();
  const listPath = `/members?limit=50${filterString ? `&${filterString}` : ''}`;
  const firstPage = useApiGet<Page<MemberListItemDto>>(listPath);

  const listKey = `${listPath}:${JSON.stringify(firstPage.data?.items.map((item) => item.id))}`;
  const extra = more?.listKey === listKey ? more : null;
  const items = [...(firstPage.data?.items ?? []), ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.nextCursor : (firstPage.data?.nextCursor ?? null);
  const filtered = Boolean(query || status || locationId);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const result = await api.get<Page<MemberListItemDto>>(`${listPath}&cursor=${nextCursor}`);
    setLoadingMore(false);
    if (result.ok) {
      setMore({
        listKey,
        items: [...(extra?.items ?? []), ...result.data.items],
        nextCursor: result.data.nextCursor,
      });
    }
  }

  function exportAs(format: 'xlsx' | 'csv') {
    exporting.run(
      () =>
        api.download(`/members/export?format=${format}${filterString ? `&${filterString}` : ''}`),
      (file) => {
        saveFile(file, `members.${format}`);
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('members.title')}</h1>
        <div className="flex flex-wrap gap-2">
          {canExport && (
            <>
              <Button
                variant="outline"
                disabled={exporting.pending}
                onClick={() => {
                  exportAs('xlsx');
                }}
              >
                {t('members.export')}
              </Button>
              <Button
                variant="outline"
                disabled={exporting.pending}
                onClick={() => {
                  exportAs('csv');
                }}
              >
                {t('members.exportCsv')}
              </Button>
            </>
          )}
          {canImport && (
            <Button variant="outline" asChild>
              <Link href="/members/import">{t('members.import')}</Link>
            </Button>
          )}
          {canManage && (
            <Button asChild>
              <Link href="/members/new">{t('members.add')}</Link>
            </Button>
          )}
        </div>
      </div>
      <FormMessage error={exporting.error} />

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input
          type="search"
          aria-label={t('members.search')}
          placeholder={t('members.search')}
          value={search}
          autoFocus
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <Select
          aria-label={t('members.status')}
          className="sm:w-48"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as MemberStatus | '');
          }}
        >
          <option value="">{t('members.allStatuses')}</option>
          {MEMBER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`memberFile.status.${value}`)}
            </option>
          ))}
        </Select>
        {(locations.data?.length ?? 0) > 1 && (
          <Select
            aria-label={t('members.location')}
            className="sm:w-48"
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
            }}
          >
            <option value="">{t('members.allLocations')}</option>
            {locations.data?.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {firstPage.error ? (
        <LoadFailed onRetry={firstPage.reload} />
      ) : !firstPage.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>{filtered ? t('members.notFound') : t('members.empty')}</Empty>
      ) : (
        <>
          <ul className="flex flex-col divide-y rounded-lg border" aria-busy={firstPage.loading}>
            {items.map((member) => (
              <li key={member.id}>
                <Link
                  href={`/members/${member.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <MemberAvatar name={fullName(member)} photoUrl={member.photoUrl} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{fullName(member)}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {member.phone} · {member.homeLocation.name}
                    </span>
                    {member.membership && (
                      <span className="truncate text-sm text-muted-foreground">
                        {[
                          member.membership.planName,
                          member.membership.status === 'scheduled'
                            ? t('memberships.summary.startsLater')
                            : member.membership.daysLeft !== null &&
                              t('memberships.daysLeft', { count: member.membership.daysLeft }),
                          member.membership.visitsLeft !== null &&
                            t('memberships.summary.visits', {
                              count: member.membership.visitsLeft,
                            }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                  <MemberStatusBadge status={member.status} />
                </Link>
              </li>
            ))}
          </ul>
          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {t('common.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
