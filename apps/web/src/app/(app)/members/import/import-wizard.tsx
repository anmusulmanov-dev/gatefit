'use client';

import {
  IMPORT_FIELDS,
  type ImportField,
  importMappingSchema,
  MEMBER_FILE_MAX_BYTES,
  type MemberImportDto,
} from '@gatefit/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useEffect, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import type { MemberScope } from '../member-scope';
import { saveFile, useMemberLocations } from '../member-ui';

const POLL_MS = 1000;
const STEPS = ['upload', 'mapping', 'check', 'done'] as const;
type Step = (typeof STEPS)[number];

/** Column index → field, the inverse of the API's field → column mapping. */
type ColumnFields = Record<number, ImportField | undefined>;

function stepOf(job: MemberImportDto | null): Step {
  if (!job) return 'upload';
  if (job.status === 'uploaded') return 'mapping';
  if (job.status === 'validated') return 'check';
  return 'done';
}

export function ImportWizard({ scope }: { scope: MemberScope }) {
  const t = useTranslations();
  const action = useApiAction();
  const locations = useMemberLocations(scope);
  const [job, setJob] = useState<MemberImportDto | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<ColumnFields>({});
  const [chosenLocationId, setLocationId] = useState(scope.currentLocationId ?? '');
  const [remapping, setRemapping] = useState(false);

  const step = remapping ? 'mapping' : stepOf(job);
  const locationOptions = locations.data ?? [];
  const locationId = locationOptions.some((location) => location.id === chosenLocationId)
    ? chosenLocationId
    : (locationOptions[0]?.id ?? '');

  // The background job reports its progress on the import itself.
  const running = job?.status === 'queued' || job?.status === 'running';
  const pollId = running ? job.id : null;
  useEffect(() => {
    if (!pollId) return;
    const timer = setInterval(() => {
      void api.get<MemberImportDto>(`/members/imports/${pollId}`).then((result) => {
        if (result.ok) setJob(result.data);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [pollId]);

  function accept(next: MemberImportDto) {
    setJob(next);
    setRemapping(false);
    const byColumn: ColumnFields = {};
    for (const [field, column] of Object.entries(next.mapping)) {
      byColumn[column] = field as ImportField;
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
      () => api.upload<MemberImportDto>('POST', '/members/imports', file, file.name),
      accept,
    );
  }

  function validate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job) return;
    const mapping: Partial<Record<ImportField, number>> = {};
    for (const [column, field] of Object.entries(columns)) {
      if (field) mapping[field] = Number(column);
    }
    const parsed = importMappingSchema.safeParse(mapping);
    if (!parsed.success || !locationId) {
      action.fail(t('members.importWizard.mappingInvalid'));
      return;
    }
    action.run(
      () =>
        api.post<MemberImportDto>(`/members/imports/${job.id}/validate`, {
          mapping: parsed.data,
          homeLocationId: locationId,
        }),
      accept,
    );
  }

  function start() {
    if (!job) return;
    action.run(() => api.post<MemberImportDto>(`/members/imports/${job.id}/commit`), setJob);
  }

  function downloadTemplate() {
    action.run(
      () => api.download('/members/imports/template'),
      (template) => {
        saveFile(template, 'members-template.xlsx');
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
      <h1 className="text-2xl font-semibold">{t('members.importWizard.title')}</h1>

      <ol className="flex flex-wrap gap-2 text-sm" aria-label={t('members.importWizard.title')}>
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
          <p className="text-sm text-muted-foreground">{t('members.importWizard.uploadHint')}</p>
          <Field id="import-file" label={t('members.importWizard.chooseFile')}>
            <Input
              id="import-file"
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
          <p className="text-sm text-muted-foreground">{t('members.importWizard.mappingHint')}</p>
          <p className="text-sm">
            {job.fileName} · {t('members.importWizard.rowsTotal', { count: job.totalRows })}
          </p>
          <div className="overflow-x-auto rounded-lg border">
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
                            ImportField | undefined;
                          setColumns((current) => ({ ...current, [column]: field }));
                        }}
                      >
                        <option value="">{t('members.importWizard.skip')}</option>
                        {IMPORT_FIELDS.map((field) => (
                          <option
                            key={field}
                            value={field}
                            disabled={usedFields.has(field) && columns[column] !== field}
                          >
                            {t(`memberFile.columns.${field}`)}
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
          <Field
            id="import-location"
            label={t('members.importWizard.location')}
            className="max-w-sm"
          >
            <Select
              id="import-location"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
              }}
            >
              {locationOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
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
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              {t('members.importWizard.valid', { count: job.validRows ?? 0 })}
            </span>
            {job.errorCount > 0 && (
              <span className="font-medium text-destructive">
                {t('members.importWizard.invalid', { count: job.errorCount })}
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
              <div className="max-h-96 overflow-auto rounded-lg border">
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
                          {error.field ? t(`memberFile.columns.${error.field}`) : '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          {t(`members.importWizard.rowErrors.${error.code}`)}
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
              {t('members.importWizard.start', { count: job.validRows ?? 0 })}
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
                {t('members.importWizard.finished', { created: job.createdCount ?? 0 })}
              </p>
              {(job.skippedCount ?? 0) > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('members.importWizard.skipped', { count: job.skippedCount ?? 0 })}
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
                <Link href="/members">{t('members.importWizard.toList')}</Link>
              </Button>
            </FormActions>
          )}
        </div>
      )}
    </div>
  );
}
