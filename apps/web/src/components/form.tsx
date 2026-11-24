import type * as React from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** A labelled form control with an optional hint underneath. */
export function Field({
  id,
  label,
  hint,
  optional,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  /** Text shown after the label, e.g. "optional". */
  optional?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> ({optional})</span>}
      </Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A checkbox with its label to the right; the whole row is clickable. */
export function CheckboxRow({
  label,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { label: string }) {
  return (
    <label
      className={cn(
        'flex items-start gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60',
        className,
      )}
    >
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** A form-level message: errors are announced, confirmations are polite. */
export function FormMessage({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p
        role="status"
        className="flex animate-rise items-center gap-2 text-sm font-medium text-ok-ink"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5 shrink-0 rounded-full bg-ok p-1 text-ok-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="40" className="animate-draw" />
        </svg>
        {success}
      </p>
    );
  }
  return null;
}

/** The right-aligned button row at the bottom of a form or dialog. */
export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-2">{children}</div>;
}
