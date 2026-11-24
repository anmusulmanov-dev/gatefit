'use client';

import { COLOR_MODE_COOKIE, COLOR_MODES, type ColorMode } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';

const icons: Record<ColorMode, ReactNode> = {
  system: <path d="M4 5h16v11H4zM9 20h6M12 16v4" />,
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
};

/** Switches the page at once and remembers the choice for the server's next render. */
function applyColorMode(mode: ColorMode): void {
  document.documentElement.dataset.mode = mode;
  document.cookie = `${COLOR_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
}

/** Light, dark or the system's: kept in a cookie so the server renders the right one. */
export function ModeSwitcher({
  initial,
  className = '',
}: {
  initial: ColorMode;
  className?: string;
}) {
  const t = useTranslations('common');
  const [mode, setMode] = useState<ColorMode>(initial);

  function choose(next: ColorMode) {
    setMode(next);
    applyColorMode(next);
  }

  return (
    <div
      role="group"
      aria-label={t('colorMode')}
      className={`inline-flex rounded-md border bg-card p-0.5 ${className}`}
    >
      {COLOR_MODES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          aria-label={t(`colorModes.${option}`)}
          title={t(`colorModes.${option}`)}
          onClick={() => {
            choose(option);
          }}
          className="grid size-8 place-items-center rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-brand-soft aria-pressed:text-brand-ink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icons[option]}
          </svg>
        </button>
      ))}
    </div>
  );
}
