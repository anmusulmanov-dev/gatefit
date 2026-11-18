import { z } from 'zod';
import { newPasswordSchema, phoneSchema } from './auth';
import { SAAS_MODULES, type SaasModule } from './modules';
import { ORGANIZATION_LOCALES, timezoneSchema } from './organization';
import { pageQuerySchema } from './pagination';

// ---------------------------------------------------------------------------
// Organization address
// ---------------------------------------------------------------------------

/** Subdomains that belong to the platform itself and can never be an organization. */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'app',
  'mail',
  'my',
  'static',
  'status',
  'www',
];

/** A DNS label: lower-case letters, digits and inner hyphens, at most 63 characters. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const organizationSlugSchema = z
  .string()
  .regex(SLUG_PATTERN, 'Use lower-case letters, digits and hyphens')
  .refine((slug) => !RESERVED_SLUGS.includes(slug), 'This address is reserved');

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * An amount in the smallest unit of its currency (tiyin, cent), as a string of digits.
 * It travels as a string so no client ever holds money in a floating-point number.
 */
export const minorAmountSchema = z.string().regex(/^(0|[1-9]\d{0,17})$/, 'Amount in minor units');

const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');
const countrySchema = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 country code');

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export const planLimitsSchema = z.object({
  /** Active members allowed per location; null means unlimited. */
  activeMembersPerLocation: z.number().int().positive().nullable(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

const modulesSchema = z.array(z.enum(SAAS_MODULES)).transform((modules) => [...new Set(modules)]);
const planNameSchema = z.string().trim().min(1).max(60);

export const saasPlanCreateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Lower-case identifier'),
  name: planNameSchema,
  limits: planLimitsSchema,
  modules: modulesSchema,
  priceMinor: minorAmountSchema,
  currency: currencySchema,
});
export type SaasPlanCreateInput = z.infer<typeof saasPlanCreateSchema>;

export const saasPlanUpdateSchema = z
  .object({
    name: planNameSchema.optional(),
    limits: planLimitsSchema.optional(),
    modules: modulesSchema.optional(),
    priceMinor: minorAmountSchema.optional(),
    currency: currencySchema.optional(),
    /** An inactive plan stays on organizations that have it but cannot be assigned anew. */
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type SaasPlanUpdateInput = z.infer<typeof saasPlanUpdateSchema>;

export interface SaasPlanDto {
  id: string;
  key: string;
  name: string;
  limits: PlanLimits;
  modules: SaasModule[];
  priceMinor: string;
  currency: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Organizations, as the platform sees them
// ---------------------------------------------------------------------------

const personNameSchema = z.string().trim().min(1).max(80);

export const platformOrganizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: organizationSlugSchema,
  country: countrySchema,
  currency: currencySchema,
  locale: z.enum(ORGANIZATION_LOCALES),
  planId: z.uuid(),
  billingPeriod: z.enum(['monthly', 'yearly']).default('monthly'),
  /** Length of the free trial; 0 starts the organization as active. */
  trialDays: z.number().int().min(0).max(365).default(14),
  location: z.object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(300).nullish(),
    timezone: timezoneSchema,
  }),
  owner: z.object({
    phone: phoneSchema,
    firstName: personNameSchema,
    lastName: personNameSchema,
    /** Must be replaced at the owner's first sign-in. */
    temporaryPassword: newPasswordSchema,
  }),
  /** Version of the public offer the customer accepted, when that is on record. */
  offerVersion: z.string().trim().min(1).max(40).optional(),
});
export type PlatformOrganizationCreateInput = z.infer<typeof platformOrganizationCreateSchema>;

export const platformOrganizationUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    locale: z.enum(ORGANIZATION_LOCALES).optional(),
    country: countrySchema.optional(),
    currency: currencySchema.optional(),
    status: z.enum(['trial', 'active', 'blocked']).optional(),
    trialEndsAt: z.iso.datetime().nullable().optional(),
    planId: z.uuid().optional(),
    billingPeriod: z.enum(['monthly', 'yearly']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type PlatformOrganizationUpdateInput = z.infer<typeof platformOrganizationUpdateSchema>;

export const platformOrganizationListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['trial', 'active', 'blocked']).optional(),
  /** Matches the start of the name or the address, case-insensitively. */
  search: z.string().trim().min(1).max(60).optional(),
});
export type PlatformOrganizationListQuery = z.infer<typeof platformOrganizationListQuerySchema>;

export interface PlatformOrganizationDto {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  locale: string;
  status: 'trial' | 'active' | 'blocked';
  trialEndsAt: string | null;
  createdAt: string;
  plan: { id: string; key: string; name: string } | null;
  locationCount: number;
  staffCount: number;
}

export interface PlatformOrganizationDetailDto extends PlatformOrganizationDto {
  /** Billing period of the current subscription; null when there is none. */
  billingPeriod: 'monthly' | 'yearly' | null;
  /** The people whose credentials only the platform may reset. */
  owners: {
    staffId: string;
    phone: string;
    firstName: string;
    lastName: string;
    status: 'active' | 'inactive';
    totpEnabled: boolean;
  }[];
}

// ---------------------------------------------------------------------------
// Platform sign-in
// ---------------------------------------------------------------------------

const sixDigitCode = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

export const platformLoginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1).max(200),
  totpCode: sixDigitCode.optional(),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const platformTotpSetupSchema = z.object({ setupToken: z.string().min(1) });
export type PlatformTotpSetupInput = z.infer<typeof platformTotpSetupSchema>;

export interface PlatformMeResponse {
  id: string;
  phone: string;
  name: string;
}
