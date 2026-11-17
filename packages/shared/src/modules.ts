/**
 * Product modules a tariff can include (docs/TZ.md section 12). An endpoint that belongs
 * to a module is marked `@RequireModule('<key>')` and answers 403 when the organization's
 * plan lacks it.
 */
export const SAAS_MODULES = [
  // Start
  'members',
  'memberships',
  'access',
  'payments',
  'cash_shifts',
  'reports_daily',
  'member_app',
  // Standard
  'online_payments',
  'schedule',
  'personal_training',
  'crm',
  'reports_extended',
  // Pro
  'turnstile',
  'network_membership',
  'api_webhooks',
] as const;

export type SaasModule = (typeof SAAS_MODULES)[number];

export function isSaasModule(value: unknown): value is SaasModule {
  return typeof value === 'string' && (SAAS_MODULES as readonly string[]).includes(value);
}

const START: SaasModule[] = [
  'members',
  'memberships',
  'access',
  'payments',
  'cash_shifts',
  'reports_daily',
  'member_app',
];
const STANDARD: SaasModule[] = [
  ...START,
  'online_payments',
  'schedule',
  'personal_training',
  'crm',
  'reports_extended',
];
const PRO: SaasModule[] = [...STANDARD, 'turnstile', 'network_membership', 'api_webhooks'];

/** What the three standard tariffs start with. The live values are in the saas_plans table. */
export const DEFAULT_PLAN_MODULES = { start: START, standard: STANDARD, pro: PRO } as const;

export type DefaultPlanKey = keyof typeof DEFAULT_PLAN_MODULES;
