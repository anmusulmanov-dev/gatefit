import type * as React from 'react';

import { cn } from '@/lib/utils';

/** A native select styled like the inputs: keyboard and screen-reader behaviour for free. */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-foreground text-base shadow-xs outline-none disabled:pointer-events-none disabled:opacity-50',
        'transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/25',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Select };
