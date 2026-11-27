// Locale settings without the message catalogues, safe to import from client bundles.

export const locales = ['uz', 'ru', 'en'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'uz';

/** Cookie that stores the user's chosen interface language. */
export const LOCALE_COOKIE = 'gatefit_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Falls back to the default locale for missing or unsupported values. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}

/** API error codes that have their own message under `errors.*` in the catalogues. */
const TRANSLATED_ERROR_CODES = [
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'INVALID_TOTP',
  'INVALID_OTP',
  'OTP_EXPIRED',
  'OTP_ATTEMPTS_EXCEEDED',
  'ORGANIZATION_NOT_FOUND',
  'ORGANIZATION_BLOCKED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'PASSWORD_UNCHANGED',
  'LOCATION_NAME_TAKEN',
  'ROLE_NAME_TAKEN',
  'ROLE_IN_USE',
  'SYSTEM_ROLE_IMMUTABLE',
  'STAFF_EXISTS',
  'LAST_OWNER',
  'CANNOT_MODIFY_SELF',
  'PERMISSION_ESCALATION',
  'INVALID_REFERENCE',
  'MODULE_NOT_AVAILABLE',
  'SLUG_TAKEN',
  'PLAN_KEY_TAKEN',
  'PLAN_INACTIVE',
  'TOTP_SETUP_REQUIRED',
  'MEMBER_PHONE_TAKEN',
  'MEMBER_ARCHIVED',
  'LOCATION_NOT_ASSIGNED',
  'PLAN_NOT_AT_LOCATION',
  'TRIAL_ALREADY_USED',
  'INVALID_START_DATE',
  'MEMBERSHIP_NOT_IN_FORCE',
  'FREEZE_NOT_ALLOWED',
  'FREEZE_LIMIT_EXCEEDED',
  'FREEZE_OVERLAP',
  'INVALID_FREEZE_DATES',
  'NO_FREEZE_TO_END',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'AMOUNT_EXCEEDS_BALANCE',
  'INVOICE_VOID',
  'INVOICE_PAID',
  'REFUND_EXCEEDS_PAYMENT',
  'CASH_SHIFT_NOT_OPEN',
  'CASH_SHIFT_ALREADY_OPEN',
  'CASH_SHIFT_CLOSED',
  'INVALID_DUE_DATE',
  'RECEIPT_NO_MEMBER',
  'INSUFFICIENT_STOCK',
  'PRODUCT_INACTIVE',
  'PRODUCT_UNIT_NOT_FOR_SALE',
  'PRODUCT_UNIT_FIXED',
  'PRODUCT_BARCODE_TAKEN',
  'WALK_IN_FULL_PAYMENT',
  'RETURN_EXCEEDS_SOLD',
  'INVALID_TEMPLATE',
  'FILE_REQUIRED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'FILE_UNREADABLE',
  'IMPORT_TOO_MANY_ROWS',
  'IMPORT_NOT_VALIDATED',
  'IMPORT_ALREADY_STARTED',
  'IMPORT_NOT_FINISHED',
  'IMPORT_REVERT_BLOCKED',
] as const;

export type ErrorMessageKey = `errors.${(typeof TRANSLATED_ERROR_CODES)[number] | 'generic'}`;

/** The message key for an API error code; unknown codes get the generic message. */
export function errorMessageKey(code: string): ErrorMessageKey {
  const known = TRANSLATED_ERROR_CODES.find((candidate) => candidate === code);
  return `errors.${known ?? 'generic'}`;
}

/** Standard role names that are translated under `roles.*`; custom roles keep their own name. */
const TRANSLATED_ROLES = ['owner', 'manager', 'receptionist', 'trainer', 'accountant'] as const;

export type RoleMessageKey = `roles.${(typeof TRANSLATED_ROLES)[number]}`;

export function roleMessageKey(role: { name: string; isSystem: boolean }): RoleMessageKey | null {
  const known = role.isSystem && TRANSLATED_ROLES.find((candidate) => candidate === role.name);
  return known ? `roles.${known}` : null;
}
