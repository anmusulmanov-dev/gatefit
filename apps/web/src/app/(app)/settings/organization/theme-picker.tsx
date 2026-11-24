'use client';

import { type Theme, THEMES } from '@gatefit/shared';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * The four looks as cards, each a small live sample drawn in its own theme: the sample sets
 * data-theme on itself, so the colours come from the same tokens as the real screens.
 */
export function ThemePicker({
  value,
  onChange,
  disabled,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
  disabled: boolean;
}) {
  const t = useTranslations('orgSettings');

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{t('theme')}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {THEMES.map((theme) => (
          <label
            key={theme}
            className={cn(
              'group flex cursor-pointer flex-col gap-3 rounded-lg border-2 bg-card p-3 transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:shadow-raised has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-70 has-disabled:hover:translate-y-0',
              value === theme ? 'border-primary' : 'border-border',
            )}
          >
            <input
              type="radio"
              name="org-theme"
              value={theme}
              checked={value === theme}
              onChange={() => {
                onChange(theme);
              }}
              className="sr-only"
            />
            <ThemeSample theme={theme} />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{t(`themes.${theme}.name`)}</span>
              <span className="text-sm text-muted-foreground">
                {t(`themes.${theme}.description`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t('themeHint')}</p>
    </fieldset>
  );
}

function ThemeSample({ theme }: { theme: Theme }) {
  return (
    <span
      aria-hidden="true"
      data-theme={theme}
      className="flex h-20 overflow-hidden rounded-md border bg-background font-sans"
    >
      <span className="gf-topbar flex w-1/4 flex-col gap-1.5 p-2">
        <span className="gf-primary-fill size-3.5 rounded-sm" />
        <span className="h-1.5 w-full rounded-full bg-current opacity-25" />
        <span className="h-1.5 w-3/4 rounded-full bg-current opacity-25" />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="gf-hero flex h-7 items-center rounded-sm px-2">
          <span className="h-2 w-1/2 rounded-full bg-current opacity-60" />
        </span>
        <span className="flex gap-1.5">
          <span className="h-5 flex-1 rounded-sm bg-ok" />
          <span className="h-5 flex-1 rounded-sm bg-no" />
          <span className="gf-primary-fill h-5 flex-1 rounded-sm" />
        </span>
      </span>
    </span>
  );
}
