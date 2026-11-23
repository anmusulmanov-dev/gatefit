'use client';

import { MEMBER_PHOTO_MAX_BYTES, type MemberDto } from '@gatefit/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ChangeEvent, type SubmitEvent, useRef, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import { MemberForm } from '../member-form';
import type { MemberScope } from '../member-scope';
import { fullName, MemberAvatar, MemberStatusBadge } from '../member-ui';
import { BillingSection } from './billing-section';
import { MembershipsSection } from './memberships-section';

export function MemberCard({ id, scope }: { id: string; scope: MemberScope }) {
  const t = useTranslations();
  const format = useFormatter();
  const canManage = useCan('members.manage');
  const canArchive = useCan('members.archive');
  const canSeePayments = useCan('payments.read');
  // Bumped when a sale or freeze may have billed something, so the billing lists reload.
  const [billingVersion, setBillingVersion] = useState(0);
  const member = useApiGet<MemberDto>(`/members/${id}`);
  const action = useApiAction();
  const [editing, setEditing] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (member.error && !member.data) {
    return <LoadFailed onRetry={member.reload} />;
  }
  if (!member.data) {
    return <Loading />;
  }
  const data = member.data;
  const name = fullName(data);
  const editable = canManage && !data.archived;
  const date = (value: string) =>
    format.dateTime(new Date(`${value.slice(0, 10)}T00:00:00Z`), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });

  function onPhotoChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MEMBER_PHOTO_MAX_BYTES) {
      action.fail(t('errors.FILE_TOO_LARGE'));
      return;
    }
    action.run(
      () => api.upload<MemberDto>('PUT', `/members/${id}/photo`, file, file.name),
      member.reload,
    );
  }

  const details: [string, string | null][] = [
    [t('members.fields.phone'), data.phone],
    [t('members.fields.birthDate'), data.birthDate && date(data.birthDate)],
    [t('members.fields.gender'), data.gender && t(`memberFile.gender.${data.gender}`)],
    [t('members.fields.homeLocation'), data.homeLocation.name],
    [t('members.fields.source'), data.source && t(`memberFile.source.${data.source}`)],
    [t('members.fields.emergencyContactName'), data.emergencyContactName],
    [t('members.fields.emergencyContactPhone'), data.emergencyContactPhone],
    [t('members.fields.notes'), data.notes],
    [t('members.fields.createdAt'), date(data.createdAt)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/members" className="text-sm text-muted-foreground hover:underline">
        ← {t('members.back')}
      </Link>

      {editing ? (
        <>
          <h1 className="text-2xl font-semibold">{t('members.editTitle')}</h1>
          <MemberForm
            member={data}
            scope={scope}
            onSaved={() => {
              setEditing(false);
              member.reload();
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex flex-col items-center gap-2">
              <MemberAvatar name={name} photoUrl={data.photoUrl} size="lg" />
              {editable && (
                <>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label={t('members.photo.upload')}
                    onChange={onPhotoChosen}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={action.pending}
                    onClick={() => fileInput.current?.click()}
                  >
                    {data.photoUrl ? t('members.photo.replace') : t('members.photo.upload')}
                  </Button>
                  {data.photoUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={action.pending}
                      onClick={() => {
                        action.run(() => api.delete(`/members/${id}/photo`), member.reload);
                      }}
                    >
                      {t('members.photo.remove')}
                    </Button>
                  )}
                  <p className="max-w-40 text-center text-xs text-muted-foreground">
                    {t('members.photo.hint')}
                  </p>
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{name}</h1>
                <MemberStatusBadge status={data.status} />
                {data.archived && <Badge tone="muted">{t('members.archive.archived')}</Badge>}
              </div>
              {data.status === 'blocked' && data.blockedReason && (
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  {t('members.block.reasonShown', { reason: data.blockedReason })}
                </p>
              )}
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
                {details
                  .filter((row): row is [string, string] => Boolean(row[1]))
                  .map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd className="text-sm break-words whitespace-pre-line">{value}</dd>
                    </div>
                  ))}
              </dl>
              <FormMessage error={action.error} />
              <div className="flex flex-wrap gap-2 pt-2">
                {editable && (
                  <Button
                    onClick={() => {
                      setEditing(true);
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                )}
                {editable &&
                  (data.status === 'blocked' ? (
                    <Button
                      variant="outline"
                      disabled={action.pending}
                      onClick={() => {
                        action.run(() => api.post(`/members/${id}/unblock`), member.reload);
                      }}
                    >
                      {t('members.block.unblock')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBlocking(true);
                      }}
                    >
                      {t('members.block.action')}
                    </Button>
                  ))}
                {canArchive &&
                  (data.archived ? (
                    <Button
                      variant="outline"
                      disabled={action.pending}
                      onClick={() => {
                        action.run(() => api.post(`/members/${id}/restore`), member.reload);
                      }}
                    >
                      {t('members.archive.restore')}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setConfirmArchive(true);
                      }}
                    >
                      {t('members.archive.action')}
                    </Button>
                  ))}
              </div>
            </div>
          </div>
          <MembershipsSection
            memberId={id}
            homeLocationId={data.homeLocation.id}
            archived={data.archived}
            scope={scope}
            onChanged={() => {
              member.reload();
              setBillingVersion((current) => current + 1);
            }}
          />
          {canSeePayments && (
            <BillingSection
              memberId={id}
              archived={data.archived}
              version={billingVersion}
              onChanged={member.reload}
            />
          )}
        </>
      )}

      {blocking && (
        <BlockDialog
          memberId={id}
          onClose={() => {
            setBlocking(false);
          }}
          onDone={() => {
            setBlocking(false);
            member.reload();
          }}
        />
      )}
      {confirmArchive && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmArchive(false);
          }}
          title={t('members.archive.action')}
          description={t('members.archive.confirmText', { name })}
        >
          <FormActions>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmArchive(false);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={action.pending}
              onClick={() => {
                action.run(
                  () => api.post(`/members/${id}/archive`),
                  () => {
                    setConfirmArchive(false);
                    member.reload();
                  },
                );
              }}
            >
              {t('members.archive.action')}
            </Button>
          </FormActions>
        </Dialog>
      )}
    </div>
  );
}

function BlockDialog({
  memberId,
  onClose,
  onDone,
}: {
  memberId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const [reason, setReason] = useState('');

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) {
      action.fail();
      return;
    }
    action.run(() => api.post(`/members/${memberId}/block`, { reason: reason.trim() }), onDone);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('members.block.title')}
      description={t('members.block.description')}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="block-reason" label={t('members.block.reason')}>
          <Input
            id="block-reason"
            value={reason}
            maxLength={500}
            required
            autoFocus
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
          <Button type="submit" variant="destructive" disabled={action.pending}>
            {t('members.block.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
