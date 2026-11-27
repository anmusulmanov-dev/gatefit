'use client';

import { ORGANIZATION_LOGO_MAX_BYTES, type OrganizationDto } from '@gatefit/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, useRef } from 'react';

import { FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';
import { cn } from '@/lib/utils';

/** The organization's logo (TZ F-10.7): uploaded and removed at once, outside the form. */
export function LogoSection({
  organization,
  canEdit,
  onChanged,
}: {
  organization: OrganizationDto;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const action = useApiAction();
  const fileInput = useRef<HTMLInputElement>(null);

  // The header and the tab icon come from the server: refresh them too.
  function done() {
    onChanged();
    router.refresh();
  }

  function onChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > ORGANIZATION_LOGO_MAX_BYTES) {
      action.fail(t('errors.IMAGE_TOO_LARGE'));
      return;
    }
    action.run(
      () => api.upload<OrganizationDto>('PUT', '/organization/logo', file, file.name),
      done,
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="org-logo-title">
      <h2 id="org-logo-title" className="text-sm font-medium">
        {t('orgSettings.logo')}
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        <div
          // White behind a logo, as in the header tile, so a dark logo stays readable.
          className={cn(
            'grid h-20 w-40 shrink-0 place-items-center rounded-lg border p-2 shadow-card',
            organization.logoUrl ? 'bg-white' : 'bg-card',
          )}
        >
          {organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed link from our own API
            <img
              src={organization.logoUrl}
              alt={t('orgSettings.logoAlt', { name: organization.name })}
              className="max-h-full max-w-full animate-pop object-contain"
            />
          ) : (
            <span className="text-center text-xs text-muted-foreground">
              {t('orgSettings.logoNone')}
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label={t('orgSettings.logoUpload')}
              onChange={onChosen}
            />
            <Button
              variant="outline"
              disabled={action.pending}
              onClick={() => fileInput.current?.click()}
            >
              {organization.logoUrl ? t('orgSettings.logoReplace') : t('orgSettings.logoUpload')}
            </Button>
            {organization.logoUrl && (
              <Button
                variant="ghost"
                disabled={action.pending}
                onClick={() => {
                  action.run(() => api.delete('/organization/logo'), done);
                }}
              >
                {t('orgSettings.logoRemove')}
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('orgSettings.logoHint')}</p>
      <FormMessage error={action.error} />
    </section>
  );
}
