'use client';

import type { Page, PlatformOrganizationDto, SaasPlanDto } from '@gatefit/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { platformApi } from '@/lib/platform-api';
import { useApiGet } from '@/lib/use-api';

import { CreateOrganizationDialog } from './create-organization-dialog';
import { StatusBadge } from './status-badge';

type StatusFilter = '' | 'trial' | 'active' | 'blocked';

interface MorePages {
  listKey: string;
  items: PlatformOrganizationDto[];
  nextCursor: string | null;
}

export function OrganizationsManager() {
  const t = useTranslations();
  const format = useFormatter();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [creating, setCreating] = useState(false);
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = new URLSearchParams({ limit: '50' });
  if (search) query.set('search', search);
  if (status) query.set('status', status);
  const listPath = `/organizations?${query.toString()}`;

  const firstPage = useApiGet<Page<PlatformOrganizationDto>>(listPath, platformApi);
  const plans = useApiGet<SaasPlanDto[]>('/saas-plans', platformApi);

  const listKey = `${listPath}:${JSON.stringify(firstPage.data?.items.map((item) => item.id))}`;
  const extra = more?.listKey === listKey ? more : null;
  const items = [...(firstPage.data?.items ?? []), ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.nextCursor : (firstPage.data?.nextCursor ?? null);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const result = await platformApi.get<Page<PlatformOrganizationDto>>(
      `${listPath}&cursor=${nextCursor}`,
    );
    setLoadingMore(false);
    if (result.ok) {
      setMore({
        listKey,
        items: [...(extra?.items ?? []), ...result.data.items],
        nextCursor: result.data.nextCursor,
      });
    }
  }

  function onSearch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {t('platform.nav.organizations')}
        </h1>
        <Button
          disabled={!plans.data}
          onClick={() => {
            setCreating(true);
          }}
        >
          {t('platformOrgs.add')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} role="search" className="flex min-w-60 flex-1 gap-2">
          <Input
            type="search"
            aria-label={t('platformOrgs.search')}
            placeholder={t('platformOrgs.search')}
            value={searchInput}
            maxLength={60}
            onChange={(event) => {
              setSearchInput(event.target.value);
              if (event.target.value === '') setSearch('');
            }}
          />
        </form>
        <Select
          aria-label={t('platformOrgs.status')}
          className="w-auto"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
          }}
        >
          <option value="">{t('platformOrgs.allStatuses')}</option>
          <option value="trial">{t('orgSettings.statusValues.trial')}</option>
          <option value="active">{t('orgSettings.statusValues.active')}</option>
          <option value="blocked">{t('orgSettings.statusValues.blocked')}</option>
        </Select>
      </div>

      {firstPage.error ? (
        <LoadFailed onRetry={firstPage.reload} />
      ) : !firstPage.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>{t('platformOrgs.empty')}</Empty>
      ) : (
        <>
          <ul
            className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50"
            aria-busy={firstPage.loading}
          >
            {items.map((organization) => (
              <li key={organization.id}>
                <Link
                  href={`/platform/organizations/${organization.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{organization.name}</span>
                      <StatusBadge status={organization.status} />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {[
                        organization.slug,
                        organization.plan?.name ?? t('platformOrgs.noPlan'),
                        t('platformOrgs.locationsCount', { count: organization.locationCount }),
                        t('platformOrgs.staffCount', { count: organization.staffCount }),
                      ].join(' · ')}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {format.dateTime(new Date(organization.createdAt), { dateStyle: 'medium' })}
                  </span>
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

      {creating && plans.data && (
        <CreateOrganizationDialog
          plans={plans.data.filter((plan) => plan.isActive)}
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
