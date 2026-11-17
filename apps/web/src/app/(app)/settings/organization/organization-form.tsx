'use client';

import {
  ORGANIZATION_LOCALES,
  type OrganizationDto,
  organizationUpdateSchema,
} from '@gatefit/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

export function OrganizationForm() {
  const organization = useApiGet<OrganizationDto>('/organization');

  if (organization.error) {
    return <LoadFailed onRetry={organization.reload} />;
  }
  if (!organization.data) {
    return <Loading />;
  }
  // Not keyed by the data: after a save the fields already hold the saved values, and
  // remounting would drop the confirmation message.
  return <Editor organization={organization.data} onSaved={organization.reload} />;
}

function Editor({ organization, onSaved }: { organization: OrganizationDto; onSaved: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const canEdit = useCan('organization.update');
  const action = useApiAction();
  const [name, setName] = useState(organization.name);
  const [locale, setLocale] = useState(organization.locale);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const input = organizationUpdateSchema.safeParse({ name, locale });
    if (!input.success) {
      action.fail();
      return;
    }
    action.run(
      () => api.patch('/organization', input.data),
      () => {
        setSaved(true);
        onSaved();
      },
    );
  }

  const facts: [string, string][] = [
    [t('orgSettings.address'), organization.slug],
    [t('orgSettings.country'), organization.country],
    [t('orgSettings.currency'), organization.currency],
    [t('orgSettings.status'), t(`orgSettings.statusValues.${organization.status}`)],
  ];
  if (organization.trialEndsAt) {
    facts.push([
      t('orgSettings.trialEndsAt'),
      format.dateTime(new Date(organization.trialEndsAt), { dateStyle: 'long' }),
    ]);
  }
  const limit = organization.plan?.limits.activeMembersPerLocation;
  facts.push([
    t('orgSettings.plan'),
    organization.plan
      ? `${organization.plan.name} · ${
          limit == null
            ? t('orgSettings.unlimited')
            : t('orgSettings.memberLimit', { count: format.number(limit) })
        }`
      : t('orgSettings.noPlan'),
  ]);

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="org-name" label={t('orgSettings.name')}>
          <Input
            id="org-name"
            value={name}
            maxLength={120}
            required
            disabled={!canEdit}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field id="org-locale" label={t('orgSettings.locale')} hint={t('orgSettings.localeHint')}>
          <Select
            id="org-locale"
            value={locale}
            disabled={!canEdit}
            onChange={(event) => {
              setLocale(event.target.value);
            }}
          >
            {ORGANIZATION_LOCALES.map((code) => (
              <option key={code} value={code} lang={code}>
                {t(`languages.${code}`)}
              </option>
            ))}
          </Select>
        </Field>
        <FormMessage error={action.error} success={saved ? t('common.saved') : null} />
        {canEdit ? (
          <FormActions>
            <Button type="submit" disabled={action.pending}>
              {t('common.save')}
            </Button>
          </FormActions>
        ) : (
          <p className="text-sm text-muted-foreground">{t('orgSettings.readOnly')}</p>
        )}
      </form>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-[auto_1fr]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-6 text-sm text-muted-foreground">{t('orgSettings.platformHint')}</p>
    </div>
  );
}
