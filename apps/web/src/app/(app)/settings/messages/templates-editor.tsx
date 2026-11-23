'use client';

import {
  type NotificationTemplateDto,
  renderTemplate,
  TEMPLATE_MAX_LENGTH,
  type TemplateLocale,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { FormActions, FormMessage } from '@/components/form';
import { LoadFailed, Loading } from '@/components/page-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

/** Sample values for the preview, so staff see a finished message. */
const SAMPLE: Record<string, string> = {
  organization: 'Gatefit Demo',
  amount: 'UZS 450 000,00',
  number: '2026-000123',
  balance: 'UZS 0,00',
  name: 'Aziz',
  plan: 'Oylik',
  date: '25.12.2026',
  days: '3',
};

/** Message templates of the club (docs/TZ.md F-4.2, F-7.2): edit, preview, reset. */
export function TemplatesEditor() {
  const t = useTranslations('messages');
  const templates = useApiGet<NotificationTemplateDto[]>('/notification-templates');
  const [locale, setLocale] = useState<TemplateLocale>('uz');

  if (templates.error) {
    return <LoadFailed onRetry={templates.reload} />;
  }
  if (!templates.data) {
    return <Loading />;
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div role="tablist" aria-label={t('language')} className="flex gap-2">
        {(['uz', 'ru', 'en'] as const).map((item) => (
          <Button
            key={item}
            role="tab"
            aria-selected={locale === item}
            size="sm"
            variant={locale === item ? 'default' : 'outline'}
            onClick={() => {
              setLocale(item);
            }}
          >
            {t(`locales.${item}`)}
          </Button>
        ))}
      </div>
      {templates.data
        .filter((template) => template.locale === locale)
        .map((template) => (
          <TemplateCard
            key={`${template.key}:${template.locale}:${template.body}`}
            template={template}
            onSaved={templates.reload}
          />
        ))}
    </div>
  );
}

function TemplateCard({
  template,
  onSaved,
}: {
  template: NotificationTemplateDto;
  onSaved: () => void;
}) {
  const t = useTranslations('messages');
  const action = useApiAction();
  const [body, setBody] = useState(template.body);
  const id = `template-${template.key}-${template.locale}`;
  const changed = body.trim() !== template.body;

  const save = (value: string | null) => {
    action.run(
      () => api.put(`/notification-templates/${template.key}/${template.locale}`, { body: value }),
      onSaved,
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-title`} className="font-semibold">
          {t(`keys.${template.key}`)}
        </h3>
        <Badge tone={template.isDefault ? 'muted' : 'positive'}>
          {template.isDefault ? t('standard') : t('custom')}
        </Badge>
      </div>
      <label htmlFor={id} className="sr-only">
        {t(`keys.${template.key}`)}
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={TEMPLATE_MAX_LENGTH}
        value={body}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        onChange={(event) => {
          setBody(event.target.value);
        }}
      />
      <p className="text-sm text-muted-foreground">
        {t('variables')}{' '}
        {template.variables.map((name) => (
          <code key={name} className="mr-1 rounded bg-muted px-1">{`{${name}}`}</code>
        ))}
        · {t('length', { count: body.length })}
      </p>
      <div className="rounded-md bg-muted px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t('preview')}: </span>
        {renderTemplate(body, SAMPLE)}
      </div>
      <FormMessage error={action.error} />
      <FormActions>
        {!template.isDefault && (
          <Button
            variant="outline"
            disabled={action.pending}
            onClick={() => {
              save(null);
            }}
          >
            {t('reset')}
          </Button>
        )}
        <Button
          disabled={action.pending || !changed || !body.trim()}
          onClick={() => {
            save(body.trim());
          }}
        >
          {t('save')}
        </Button>
      </FormActions>
    </section>
  );
}
