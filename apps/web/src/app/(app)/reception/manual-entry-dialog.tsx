'use client';

import type { AccessResultDto, MemberListItemDto, Page } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Empty, Loading } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useApiAction, useApiGet } from '@/lib/use-api';

const MIN_QUERY = 2;

/**
 * Letting a member in by hand (docs/TZ.md F-3.4): find them by phone or name and say why.
 * The entry is recorded as allowed whatever the rules say; the audit trail keeps both.
 */
export function ManualEntryDialog({
  locationId,
  onClose,
  onDone,
}: {
  locationId: string;
  onClose: () => void;
  onDone: (result: AccessResultDto) => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MemberListItemDto | null>(null);
  const [reason, setReason] = useState('');
  const q = query.trim();
  const found = useApiGet<Page<MemberListItemDto>>(
    q.length >= MIN_QUERY ? `/members?q=${encodeURIComponent(q)}&limit=8` : null,
  );

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !reason.trim()) {
      action.fail(t('access.manual.required'));
      return;
    }
    action.run(
      () =>
        api.post<AccessResultDto>('/access/manual', {
          memberId: selected.id,
          locationId,
          reason: reason.trim(),
        }),
      onDone,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('access.manual.title')}
      description={t('access.manual.description')}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="manual-search" label={t('access.manual.search')}>
          <Input
            id="manual-search"
            value={query}
            autoFocus
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
          />
        </Field>
        {q.length >= MIN_QUERY &&
          (!found.data ? (
            <Loading />
          ) : found.data.items.length === 0 ? (
            <Empty>{t('access.manual.notFound')}</Empty>
          ) : (
            <ul
              className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50"
              aria-label={t('access.manual.results')}
            >
              {found.data.items.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    aria-pressed={selected?.id === member.id}
                    className={cn(
                      'flex w-full flex-wrap justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                      selected?.id === member.id && 'bg-accent font-medium',
                    )}
                    onClick={() => {
                      setSelected(member);
                    }}
                  >
                    <span>
                      {member.lastName} {member.firstName}
                    </span>
                    <span className="text-muted-foreground">{member.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        <Field id="manual-reason" label={t('access.manual.reason')}>
          <Input
            id="manual-reason"
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending || !selected}>
            {t('access.manual.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
