// Money moves as strings of digits in the smallest unit (CLAUDE.md rule 2). These helpers
// convert between that and what a person reads and types, using string arithmetic only:
// never a floating-point number.

/** Digits after the decimal point for a currency: UZS 2 (tiyin), JPY 0, and so on. */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** "4500000" tiyin with 2 digits -> "45000.00". Accepts only a non-negative integer string. */
export function minorToDecimal(minor: string, digits: number): string {
  if (!/^\d+$/.test(minor)) {
    throw new Error('Minor amount must be a string of digits');
  }
  if (digits === 0) {
    return minor.replace(/^0+(?=\d)/, '');
  }
  const padded = minor.padStart(digits + 1, '0');
  const whole = padded.slice(0, -digits).replace(/^0+(?=\d)/, '');
  return `${whole}.${padded.slice(-digits)}`;
}

/**
 * What a person typed -> minor units: "45 000,5" with 2 digits -> "4500050". Spaces and
 * a comma as the decimal mark are accepted. Returns null for anything that is not a
 * non-negative amount with at most `digits` decimals.
 */
export function decimalToMinor(input: string, digits: number): string | null {
  const normalized = input.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) {
    return null;
  }
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > digits) {
    return null;
  }
  const minor = `${whole}${fraction.padEnd(digits, '0')}`.replace(/^0+(?=\d)/, '');
  return minor;
}

/** A minor amount for display, in the reader's locale: "45 000,00 UZS". */
export function formatMinor(minor: string, currency: string, locale: string): string {
  const digits = currencyDigits(currency);
  const decimal = minorToDecimal(minor, digits);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: digits,
  });
  // A decimal string is formatted exactly (Intl.NumberFormat v3); no float is involved.
  return formatter.format(decimal as `${number}`);
}
