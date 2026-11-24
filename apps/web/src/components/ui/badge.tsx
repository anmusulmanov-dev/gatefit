import type * as React from 'react';

import { cn } from '@/lib/utils';

const tones = {
  neutral: 'bg-secondary text-secondary-foreground',
  positive: 'bg-ok-soft text-ok-ink',
  negative: 'bg-no-soft text-no-ink',
  warning: 'bg-warn-soft text-warn-ink',
  brand: 'bg-brand-soft text-brand-ink',
  muted: 'border text-muted-foreground',
} as const;

function Badge({
  className,
  tone = 'neutral',
  ...props
}: React.ComponentProps<'span'> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
