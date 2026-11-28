'use client';

import {
  formatMinor,
  MEMBER_FILE_MAX_BYTES,
  MEMBERSHIP_IMPORT_FIELDS,
  type MembershipImportDto,
  type MembershipImportField,
  membershipImportMappingSchema,
  type Page,
} from '@gatefit/shared';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type SubmitEvent, useEffect, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useCan } from '@/components/staff-session';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { saveFile } from '../../member-ui';

const POLL_MS = 1000;
const STEPS = ['upload', 'mapping', 'check', 'done'] as const;
type Step = (typeof STEPS)[number];

/** Column index → field, the inverse of the API's field → column mapping. */
type ColumnFields = Record<number, MembershipImportField | undefined>;

function stepOf(job: MembershipImportDto | null): Step {
  if (!job) return 'upload';
  if (job.status === 'uploaded') return 'mapping';
  if (job.status === 'validated') return 'check';
  return 'done';
}

export function MembershipImportWizard() {
  const t = useTranslations();
  const locale = useLocale();
  const action = useApiAction();
  const history = useApiGet<Page<MembershipImportDto>>('/membership-imports?limit=20');
  const [job, setJob] = useState<MembershipImportDto | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<ColumnFields>({});
  const [remapping, setRemapping] = useState(false);
  const [reverting, setReverting] = useState<MembershipImportDto | null>(null);

  const step = remapping ? 'mapping' : stepOf(job);
  const money = (minor: string, currency: string) => formatMinor(minor, currency, locale);

  // The background job reports its progress on the import itself.
  const running = job?.status === 'queued' || job?.status === 'running';
  const pollId = running ? job.id : null;
  const reloadHistory = history.reload;
  useEffect(() => {
    if (!pollId) return;
    const timer = setInterval(() => {
      void api.get<MembershipImportDto>(`/membership-imports/${pollId}`).then((result) => {
        if (result.ok) {
          setJob(result.data);
          if (result.data.status === 'done' || result.data.status === 'failed') reloadHistory();
        }
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [pollId, reloadHistory]);

  function accept(next: MembershipImportDto) {
    setJob(next);
    setRemapping(false);
    const byColumn: ColumnFields = {};
    for (const [field, column] of Object.entries(next.mapping)) {
      byColumn[column] = field as MembershipImportField;
    }
    setColumns(byColumn);
  }

  function upload(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      action.fail(t('errors.FILE_REQUIRED'));
      return;
    }
    if (file.size > MEMBER_FILE_MAX_BYTES) {
      action.fail(t('errors.FILE_TOO_LARGE'));
      return;
    }
    action.run(
      () => api.upload<MembershipImportDto>('POST', '/membership-imports', file, file.name),
      accept,
    );
  }

  function validate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job) return;
    const mapping: Partial<Record<MembershipImportField, number>> = {};
    for (const [column, field] of Object.entries(columns)) {
      if (field) mapping[field] = Number(column);
    }
    const parsed = membershipImportMappingSchema.safeParse(mapping);
    if (!parsed.success) {
      action.fail(t('membershipImport.mappingInvalid'));
      return;
    }
    action.run(
      () =>
        api.post<MembershipImportDto>(`/membership-imports/${job.id}/validate`, {
          mapping: parsed.data,
        }),
      accept,
    );
  }

  function start() {
    if (!job) return;
    action.run(() => api.post<MembershipImportDto>(`/membership-imports/${job.id}/commit`), setJob);
  }

  function downloadTemplate() {
    action.run(
      () => api.download('/membership-imports/template'),
      (template) => {
        saveFile(template, 'memberships-template.xlsx');
      },
    );
  }

  function restart() {
    setJob(null);
    setFile(null);
    setColumns({});
    setRemapping(false);
    action.reset();
  }

  const usedFields = new Set(Object.values(columns).filter(Boolean));

  return (
    <div className="flex flex-col gap-6">
      <Link href="/members" className="text-sm text-muted-foreground hover:underline">
        ← {t('members.back')}
      </Link>
      <h1 className="text-2xl font-extrabold tracking-tight">{t('membershipImport.title')}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('membershipImport.intro')}</p>

      <ol className="flex flex-wrap gap-2 text-sm" aria-label={t('membershipImport.title')}>
        {STEPS.map((name, index) => (
          <li
            key={name}
            aria-current={name === step ? 'step' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-muted-foreground',
              name === step && 'border-primary bg-primary text-primary-foreground',
            )}
          >
            {index + 1}. {t(`members.importWizard.steps.${name}`)}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <form onSubmit={upload} className="flex max-w-xl flex-col gap-4" noValidate>
          <p className="text-sm text-muted-foreground">{t('membershipImport.uploadHint')}</p>
          <Field id="membership-import-file" label={t('members.importWizard.chooseFile')}>
            <Input
              id="membership-import-file"
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
          </Field>
          <FormMessage error={action.error} />
          <FormActions>
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              {t('members.importWizard.template')}
            </Button>
            <Button type="submit" disabled={action.pending}>
              {t('members.importWizard.upload')}
            </Button>
          </FormActions>
        </form>
      )}

      {step === 'mapping' && job && (
        <form onSubmit={validate} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-muted-foreground">{t('membershipImport.mappingHint')}</p>
          <p className="text-sm">
            {job.fileName} · {t('members.importWizard.rowsTotal', { count: job.totalRows })}
          </p>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('members.importWizard.column')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('members.importWizard.field')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('members.importWizard.sample')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {job.headers.map((header, column) => (
                  <tr key={column}>
                    <td className="px-3 py-2 font-medium">{header || `#${String(column + 1)}`}</td>
                    <td className="px-3 py-2">
                      <Select
                        aria-label={`${t('members.importWizard.field')}: ${header}`}
                        className="h-8 min-w-48"
                        value={columns[column] ?? ''}
                        onChange={(event) => {
                          const field = (event.target.value || undefined) as
                            MembershipImportField | undefined;
                          setColumns((current) => ({ ...current, [column]: field }));
                        }}
                      >
                        <option value="">{t('members.importWizard.skip')}</option>
                        {MEMBERSHIP_IMPORT_FIELDS.map((field) => (
                          <option
                            key={field}
                            value={field}
                            disabled={usedFields.has(field) && columns[column] !== field}
                          >
                            {t(`membershipFile.columns.${field}`)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">
                      {job.sampleRows
                        .map((row) => row[column] ?? '')
                        .filter(Boolean)
                        .slice(0, 2)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FormMessage error={action.error} />
          <FormActions>
            <Button type="button" variant="outline" onClick={restart}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={action.pending}>
              {t('members.importWizard.validate')}
            </Button>
          </FormActions>
        </form>
      )}

      {step === 'check' && job && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <span>{t('members.importWizard.rowsTotal', { count: job.totalRows })}</span>
            <span className="font-medium text-ok-ink">
              {t('members.importWizard.valid', { count: job.validRows ?? 0 })}
            </span>
            {job.errorCount > 0 && (
              <span className="font-medium text-destructive">
                {t('members.importWizard.invalid', { count: job.errorCount })}
              </span>
            )}
            {job.debtMinor !== null && job.debtMinor !== '0' && (
              <span>
                {t('membershipImport.debtTotal', { amount: money(job.debtMinor, job.currency) })}
              </span>
            )}
          </div>
          {job.errors.length > 0 && (
            <>
              {job.errorCount > job.errors.length && (
                <p className="text-sm text-muted-foreground">
                  {t('members.importWizard.errorsShown', { count: job.errors.length })}
                </p>
              )}
              <div className="max-h-96 overflow-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('members.importWizard.row')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('members.importWizard.field')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('members.importWizard.problem')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {job.errors.map((error, index) => (
                      <tr key={`${String(error.row)}-${String(index)}`}>
                        <td className="px-3 py-1.5">{error.row}</td>
                        <td className="px-3 py-1.5">
                          {error.field ? t(`membershipFile.columns.${error.field}`) : '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          {t(`membershipImport.rowErrors.${error.code}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <FormMessage error={action.error} />
          <FormActions>
            <Button
              variant="outline"
              onClick={() => {
                setRemapping(true);
              }}
            >
              {t('members.importWizard.steps.mapping')}
            </Button>
            <Button disabled={action.pending || !job.validRows} onClick={start}>
              {t('membershipImport.start', { count: job.validRows ?? 0 })}
            </Button>
          </FormActions>
        </div>
      )}

      {step === 'done' && job && (
        <div className="flex flex-col gap-4" aria-live="polite">
          {running ? (
            <p role="status">{t('members.importWizard.running')}</p>
          ) : job.status === 'failed' ? (
            <p role="alert" className="text-destructive">
              {t('members.importWizard.failed')}
            </p>
          ) : (
            <>
              <p role="status" className="font-medium">
                {t('membershipImport.finished', { created: job.createdCount ?? 0 })}
              </p>
              {(job.skippedCount ?? 0) > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('membershipImport.skipped', { count: job.skippedCount ?? 0 })}
                </p>
              )}
            </>
          )}
          {!running && (
            <FormActions>
              <Button variant="outline" onClick={restart}>
                {t('members.importWizard.again')}
              </Button>
              <Button asChild>
                <Link href="/members">{t('membershipImport.toMembers')}</Link>
              </Button>
            </FormActions>
          )}
        </div>
      )}

      <ImportHistory imports={history.data?.items ?? null} money={money} onRevert={setReverting} />
      {reverting && (
        <RevertDialog
          job={reverting}
          onClose={() => {
            setReverting(null);
          }}
          onDone={() => {
            setReverting(null);
            history.reload();
          }}
        />
      )}
    </div>
  );
}

function ImportHistory({
  imports,
  money,
  onRevert,
}: {
  imports: MembershipImportDto[] | null;
  money: (minor: string, currency: string) => string;
  onRevert: (job: MembershipImportDto) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const canRevert = useCan('memberships.cancel');
  if (imports === null) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="membership-import-history">
      <h2 id="membership-import-history" className="text-lg font-bold">
        {t('membershipImport.history')}
      </h2>
      {imports.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('membershipImport.historyEmpty')}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {imports.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="font-medium">{item.fileName}</span>
              <span className="text-muted-foreground">
                {new Date(item.createdAt).toLocaleString(locale)}
              </span>
              {item.revertedAt ? (
                <Badge tone="muted">{t('membershipImport.reverted')}</Badge>
              ) : (
                <Badge tone={item.status === 'done' ? 'positive' : 'neutral'}>
                  {t(`membershipImport.statuses.${item.status}`)}
                </Badge>
              )}
              {item.createdCount !== null && (
                <span>{t('membershipImport.created', { count: item.createdCount })}</span>
              )}
              {item.debtMinor !== null && item.debtMinor !== '0' && (
                <span>{money(item.debtMinor, item.currency)}</span>
              )}
              {canRevert && item.status === 'done' && !item.revertedAt && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => {
                    onRevert(item);
                  }}
                >
                  {t('membershipImport.revert')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RevertDialog({
  job,
  onClose,
  onDone,
}: {
  job: MembershipImportDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const [reason, setReason] = useState('');

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run(
      () => api.post<MembershipImportDto>(`/membership-imports/${job.id}/revert`, { reason }),
      onDone,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('membershipImport.revertTitle')}
      description={t('membershipImport.revertHint')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id="membership-import-revert-reason" label={t('membershipImport.revertReason')}>
          <Input
            id="membership-import-revert-reason"
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
            {t('common.close')}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={action.pending || reason.trim() === ''}
          >
            {t('membershipImport.revertConfirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
