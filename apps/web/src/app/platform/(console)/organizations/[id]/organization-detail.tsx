'use client';

import {
  ORGANIZATION_LOCALES,
  type PlatformOrganizationDetailDto,
  platformOrganizationUpdateSchema,
  type SaasPlanDto,
  staffPasswordResetSchema,
} from '@gatefit/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { LoadFailed, Loading } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { platformApi } from '@/lib/platform-api';
import { generateTemporaryPassword } from '@/lib/temporary-password';
import { useApiAction, useApiGet } from '@/lib/use-api';

import { StatusBadge } from '../status-badge';

type Owner = PlatformOrganizationDetailDto['owners'][number];

/** "2027-01-31" for the date input, in the reader's own time zone. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The trial lasts to the end of the chosen day, in the reader's own time zone. */
function fromDateInput(value: string): string | null {
  return value ? new Date(`${value}T23:59:59`).toISOString() : null;
}

export function OrganizationDetail({ id }: { id: string }) {
  const t = useTranslations();
  const organization = useApiGet<PlatformOrganizationDetailDto>(
    `/organizations/${id}`,
    platformApi,
  );
  const plans = useApiGet<SaasPlanDto[]>('/saas-plans', platformApi);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/platform/organizations"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← {t('platformOrgs.back')}
      </Link>
      {organization.error ? (
        <LoadFailed onRetry={organization.reload} />
      ) : !organization.data || !plans.data ? (
        <Loading />
      ) : (
        <>
          <Header organization={organization.data} />
          <SettingsForm
            organization={organization.data}
            plans={plans.data}
            onSaved={organization.reload}
          />
          <Owners organization={organization.data} onChanged={organization.reload} />
        </>
      )}
    </div>
  );
}

function Header({ organization }: { organization: PlatformOrganizationDetailDto }) {
  const t = useTranslations('platformOrgs');
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">{organization.name}</h1>
        <StatusBadge status={organization.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        {[
          organization.slug,
          t('locationsCount', { count: organization.locationCount }),
          t('staffCount', { count: organization.staffCount }),
          `${t('createdAt')}: ${format.dateTime(new Date(organization.createdAt), { dateStyle: 'medium' })}`,
        ].join(' · ')}
      </p>
    </div>
  );
}

function SettingsForm({
  organization,
  plans,
  onSaved,
}: {
  organization: PlatformOrganizationDetailDto;
  plans: SaasPlanDto[];
  onSaved: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: organization.name,
    locale: organization.locale,
    country: organization.country,
    currency: organization.currency,
    status: organization.status,
    trialEndsAt: toDateInput(organization.trialEndsAt),
    planId: organization.plan?.id ?? '',
    billingPeriod: organization.billingPeriod ?? 'monthly',
  });
  const set = (field: keyof typeof form) => (value: string) => {
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  };

  // Plans that may be assigned, plus the current one even if it was withdrawn.
  const planOptions = plans.filter((plan) => plan.isActive || plan.id === organization.plan?.id);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    // Only what changed is sent: an unchanged plan must not open a new subscription.
    const changes: Record<string, unknown> = {};
    if (form.name !== organization.name) changes.name = form.name;
    if (form.locale !== organization.locale) changes.locale = form.locale;
    if (form.country !== organization.country) changes.country = form.country.toUpperCase();
    if (form.currency !== organization.currency) changes.currency = form.currency.toUpperCase();
    if (form.status !== organization.status) changes.status = form.status;
    if (form.trialEndsAt !== toDateInput(organization.trialEndsAt)) {
      changes.trialEndsAt = fromDateInput(form.trialEndsAt);
    }
    if (form.planId && form.planId !== organization.plan?.id) changes.planId = form.planId;
    if (form.billingPeriod !== organization.billingPeriod)
      changes.billingPeriod = form.billingPeriod;
    if (Object.keys(changes).length === 0) {
      setSaved(true);
      return;
    }

    const input = platformOrganizationUpdateSchema.safeParse(changes);
    if (!input.success) {
      action.fail();
      return;
    }
    action.run(
      () => platformApi.patch(`/organizations/${organization.id}`, input.data),
      () => {
        setSaved(true);
        onSaved();
      },
    );
  }

  const blocked = form.status === 'blocked';

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-card">
      <h2 className="text-lg font-semibold">{t('platformOrgs.settingsSection')}</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="org-status"
            label={t('platformOrgs.status')}
            hint={t('platformOrgs.blockHint')}
          >
            <Select
              id="org-status"
              value={form.status}
              onChange={(event) => {
                set('status')(event.target.value);
              }}
              aria-invalid={blocked || undefined}
            >
              <option value="trial">{t('orgSettings.statusValues.trial')}</option>
              <option value="active">{t('orgSettings.statusValues.active')}</option>
              <option value="blocked">{t('orgSettings.statusValues.blocked')}</option>
            </Select>
          </Field>
          <Field id="org-trial" label={t('platformOrgs.trialEndsAt')}>
            <div className="flex flex-col gap-2">
              <Input
                id="org-trial"
                type="date"
                value={form.trialEndsAt}
                onChange={(event) => {
                  set('trialEndsAt')(event.target.value);
                }}
              />
              {form.trialEndsAt && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    set('trialEndsAt')('');
                  }}
                >
                  {t('platformOrgs.clearTrial')}
                </Button>
              )}
            </div>
          </Field>
          <Field id="org-plan" label={t('platformOrgs.plan')}>
            <Select
              id="org-plan"
              value={form.planId}
              onChange={(event) => {
                set('planId')(event.target.value);
              }}
            >
              {!organization.plan && <option value="">{t('platformOrgs.noPlan')}</option>}
              {planOptions.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                  {plan.isActive ? '' : ` (${t('platformPlans.inactive')})`}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="org-billing" label={t('platformOrgs.billingPeriod')}>
            <Select
              id="org-billing"
              value={form.billingPeriod}
              onChange={(event) => {
                set('billingPeriod')(event.target.value);
              }}
            >
              <option value="monthly">{t('platformOrgs.billing.monthly')}</option>
              <option value="yearly">{t('platformOrgs.billing.yearly')}</option>
            </Select>
          </Field>
        </div>

        <h3 className="pt-2 text-sm font-semibold">{t('platformOrgs.detailsSection')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="org-name" label={t('platformOrgs.name')}>
            <Input
              id="org-name"
              value={form.name}
              maxLength={120}
              onChange={(event) => {
                set('name')(event.target.value);
              }}
            />
          </Field>
          <Field id="org-locale" label={t('platformOrgs.locale')}>
            <Select
              id="org-locale"
              value={form.locale}
              onChange={(event) => {
                set('locale')(event.target.value);
              }}
            >
              {ORGANIZATION_LOCALES.map((code) => (
                <option key={code} value={code} lang={code}>
                  {t(`languages.${code}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="org-country" label={t('platformOrgs.country')}>
            <Input
              id="org-country"
              value={form.country}
              maxLength={2}
              onChange={(event) => {
                set('country')(event.target.value);
              }}
            />
          </Field>
          <Field
            id="org-currency"
            label={t('platformOrgs.currency')}
            hint={t('platformOrgs.platformOnlyHint')}
          >
            <Input
              id="org-currency"
              value={form.currency}
              maxLength={3}
              onChange={(event) => {
                set('currency')(event.target.value);
              }}
            />
          </Field>
        </div>

        <FormMessage error={action.error} success={saved ? t('common.saved') : null} />
        <FormActions>
          <Button type="submit" disabled={action.pending}>
            {t('common.save')}
          </Button>
        </FormActions>
      </form>
    </section>
  );
}

function Owners({
  organization,
  onChanged,
}: {
  organization: PlatformOrganizationDetailDto;
  onChanged: () => void;
}) {
  const t = useTranslations('platformOrgs');
  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('owners')}</h2>
        <p className="text-sm text-muted-foreground">{t('resetPasswordHint')}</p>
      </div>
      {organization.owners.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noOwners')}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {organization.owners.map((owner) => (
            <OwnerRow
              key={owner.staffId}
              organizationId={organization.id}
              owner={owner}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function OwnerRow({
  organizationId,
  owner,
  onChanged,
}: {
  organizationId: string;
  owner: Owner;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const passwordAction = useApiAction();
  const totpAction = useApiAction();
  const [temporaryPassword, setTemporaryPassword] = useState(generateTemporaryPassword);
  const [done, setDone] = useState(false);
  const base = `/organizations/${organizationId}/staff/${owner.staffId}`;
  const passwordId = `owner-password-${owner.staffId}`;

  function resetPassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(false);
    const input = staffPasswordResetSchema.safeParse({ temporaryPassword });
    if (!input.success) {
      passwordAction.fail(t('account.passwordHint'));
      return;
    }
    passwordAction.run(
      () => platformApi.post(`${base}/reset-password`, input.data),
      () => {
        setDone(true);
        onChanged();
      },
    );
  }

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">
          {`${owner.firstName} ${owner.lastName}`.trim() || owner.phone}
        </span>
        <span className="text-sm text-muted-foreground">
          {[
            owner.phone,
            t(`staffSettings.statusValues.${owner.status}`),
            `${t('staffSettings.totp')}: ${owner.totpEnabled ? t('staffSettings.totpOn') : t('staffSettings.totpOff')}`,
          ].join(' · ')}
        </span>
      </div>
      <form onSubmit={resetPassword} className="flex flex-wrap items-end gap-2" noValidate>
        <Field
          id={passwordId}
          label={t('staffSettings.temporaryPassword')}
          className="min-w-48 flex-1"
        >
          <Input
            id={passwordId}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={temporaryPassword}
            onChange={(event) => {
              setTemporaryPassword(event.target.value);
            }}
          />
        </Field>
        <Button type="submit" variant="outline" disabled={passwordAction.pending}>
          {t('platformOrgs.resetPassword')}
        </Button>
        {owner.totpEnabled && (
          <Button
            type="button"
            variant="outline"
            disabled={totpAction.pending}
            onClick={() => {
              setDone(false);
              totpAction.run(
                () => platformApi.post(`${base}/reset-totp`),
                () => {
                  setDone(true);
                  onChanged();
                },
              );
            }}
          >
            {t('platformOrgs.resetTotp')}
          </Button>
        )}
      </form>
      <FormMessage
        error={passwordAction.error ?? totpAction.error}
        success={done ? t('platformOrgs.done') : null}
      />
    </li>
  );
}
