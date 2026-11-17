'use client';

import {
  ORGANIZATION_LOCALES,
  type PlatformOrganizationDetailDto,
  platformOrganizationCreateSchema,
  type SaasPlanDto,
} from '@gatefit/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useMemo, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { platformApi } from '@/lib/platform-api';
import { generateTemporaryPassword } from '@/lib/temporary-password';
import { useApiAction } from '@/lib/use-api';

/** Opens a new organization with its first location and owner, then shows it. */
export function CreateOrganizationDialog({
  plans,
  onClose,
}: {
  plans: SaasPlanDto[];
  onClose: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const action = useApiAction();
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);

  const [form, setForm] = useState({
    name: '',
    slug: '',
    country: 'UZ',
    currency: 'UZS',
    locale: 'uz',
    planId: plans[0]?.id ?? '',
    billingPeriod: 'monthly',
    trialDays: '14',
    locationName: '',
    locationAddress: '',
    timezone: 'Asia/Tashkent',
    ownerPhone: '',
    ownerFirstName: '',
    ownerLastName: '',
    temporaryPassword: generateTemporaryPassword(),
    offerVersion: '',
  });
  const set = (field: keyof typeof form) => (value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = platformOrganizationCreateSchema.safeParse({
      name: form.name,
      slug: form.slug.trim().toLowerCase(),
      country: form.country.trim().toUpperCase(),
      currency: form.currency.trim().toUpperCase(),
      locale: form.locale,
      planId: form.planId,
      billingPeriod: form.billingPeriod,
      trialDays: Number.parseInt(form.trialDays, 10),
      location: {
        name: form.locationName,
        address: form.locationAddress.trim() || null,
        timezone: form.timezone,
      },
      owner: {
        phone: form.ownerPhone,
        firstName: form.ownerFirstName,
        lastName: form.ownerLastName,
        temporaryPassword: form.temporaryPassword,
      },
      offerVersion: form.offerVersion.trim() || undefined,
    });
    if (!input.success) {
      action.fail();
      return;
    }
    action.run(
      () => platformApi.post<PlatformOrganizationDetailDto>('/organizations', input.data),
      (created) => {
        router.push(`/platform/organizations/${created.id}`);
      },
    );
  }

  const text = (
    field: keyof typeof form,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    hint?: string,
  ) => (
    <Field id={`org-${field}`} label={label} hint={hint}>
      <Input
        id={`org-${field}`}
        value={form[field]}
        onChange={(event) => {
          set(field)(event.target.value);
        }}
        {...props}
      />
    </Field>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('platformOrgs.add')}
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('name', t('platformOrgs.name'), {
            required: true,
            maxLength: 120,
            autoFocus: true,
          })}
          {text(
            'slug',
            t('platformOrgs.slug'),
            { required: true, maxLength: 63, spellCheck: false, autoCapitalize: 'none' },
            t('platformOrgs.slugHint', { slug: form.slug.trim().toLowerCase() || '…' }),
          )}
          {text('country', t('platformOrgs.country'), { required: true, maxLength: 2 })}
          {text('currency', t('platformOrgs.currency'), { required: true, maxLength: 3 })}
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
          <Field id="org-plan" label={t('platformOrgs.plan')}>
            <Select
              id="org-plan"
              value={form.planId}
              onChange={(event) => {
                set('planId')(event.target.value);
              }}
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
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
          {text(
            'trialDays',
            t('platformOrgs.trialDays'),
            { type: 'number', min: 0, max: 365, inputMode: 'numeric' },
            t('platformOrgs.trialDaysHint'),
          )}
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-semibold">
            {t('platformOrgs.locationSection')}
          </legend>
          {text('locationName', t('locations.name'), { required: true, maxLength: 120 })}
          <Field id="org-timezone" label={t('locations.timezone')}>
            <Select
              id="org-timezone"
              value={form.timezone}
              onChange={(event) => {
                set('timezone')(event.target.value);
              }}
            >
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
          {text('locationAddress', t('locations.address'), { maxLength: 300 })}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-semibold">{t('platformOrgs.ownerSection')}</legend>
          {text('ownerPhone', t('staffSettings.phone'), {
            type: 'tel',
            inputMode: 'tel',
            required: true,
            placeholder: t('auth.phonePlaceholder'),
          })}
          {text('ownerFirstName', t('staffSettings.firstName'), { required: true, maxLength: 80 })}
          {text('ownerLastName', t('staffSettings.lastName'), { required: true, maxLength: 80 })}
          <Field
            id="org-temporaryPassword"
            label={t('staffSettings.temporaryPassword')}
            hint={t('staffSettings.temporaryPasswordHint')}
          >
            <div className="flex gap-2">
              <Input
                id="org-temporaryPassword"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                value={form.temporaryPassword}
                onChange={(event) => {
                  set('temporaryPassword')(event.target.value);
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  set('temporaryPassword')(generateTemporaryPassword());
                }}
              >
                {t('staffSettings.generate')}
              </Button>
            </div>
          </Field>
        </fieldset>

        {text(
          'offerVersion',
          t('platformOrgs.offerVersion'),
          { maxLength: 40 },
          t('platformOrgs.offerVersionHint'),
        )}

        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending}>
            {t('common.save')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
