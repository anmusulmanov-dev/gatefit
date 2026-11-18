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
