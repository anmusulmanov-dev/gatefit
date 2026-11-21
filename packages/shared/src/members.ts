import { z } from 'zod';
import { phoneSchema } from './auth';
import { pageQuerySchema } from './pagination';

/**
 * docs/TZ.md F-1.3. `inactive`: no membership yet. `active`, `frozen` and `expired` follow
 * the member's memberships, `debtor` their invoices; `blocked` is set by staff.
 */
export const MEMBER_STATUSES = [
  'inactive',
  'active',
  'frozen',
  'expired',
  'debtor',
  'blocked',
] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

/** How a member found the club. `import` marks members brought in from a file. */
export const MEMBER_SOURCES = [
  'walk_in',
  'referral',
  'social',
  'website',
  'import',
  'other',
] as const;
export type MemberSource = (typeof MEMBER_SOURCES)[number];

const personNameSchema = z.string().trim().min(1).max(80);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value));

/** A calendar date, `YYYY-MM-DD`. Whether it lies in the past is checked by the API. */
export const birthDateSchema = z.iso.date().refine((value) => value >= '1900-01-01', {
  message: 'Birth date is too far in the past',
});

const memberFields = {
  firstName: personNameSchema,
  lastName: personNameSchema,
  phone: phoneSchema,
  birthDate: birthDateSchema.nullish(),
  gender: z.enum(GENDERS).nullish(),
  source: z.enum(MEMBER_SOURCES).nullish(),
  notes: optionalText(2000).nullish(),
  emergencyContactName: optionalText(120).nullish(),
  emergencyContactPhone: phoneSchema.nullish(),
  homeLocationId: z.uuid(),
};

export const memberCreateSchema = z.object(memberFields);
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;

export const memberUpdateSchema = z
  .object({
    firstName: memberFields.firstName.optional(),
    lastName: memberFields.lastName.optional(),
    phone: memberFields.phone.optional(),
    birthDate: birthDateSchema.nullable().optional(),
    gender: z.enum(GENDERS).nullable().optional(),
    source: z.enum(MEMBER_SOURCES).nullable().optional(),
    notes: optionalText(2000).nullable().optional(),
    emergencyContactName: optionalText(120).nullable().optional(),
    emergencyContactPhone: phoneSchema.nullable().optional(),
    homeLocationId: z.uuid().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

export const memberBlockSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type MemberBlockInput = z.infer<typeof memberBlockSchema>;

export const memberListQuerySchema = pageQuerySchema.extend({
  /** Any part of a first name, last name or phone; several words must all match. */
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(MEMBER_STATUSES).optional(),
  locationId: z.uuid().optional(),
});
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;

/** Possible duplicates of a member being entered (docs/TZ.md F-1.2). */
export const memberDuplicatesQuerySchema = z.object({
  phone: phoneSchema.optional(),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  birthDate: birthDateSchema.optional(),
  /** The member being edited, so it is not reported as its own duplicate. */
  excludeId: z.uuid().optional(),
});
export type MemberDuplicatesQuery = z.infer<typeof memberDuplicatesQuerySchema>;

/** Enough to recognise a member in a warning or a search result. */
export interface MemberSummaryDto {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  birthDate: string | null;
  status: MemberStatus;
  homeLocation: { id: string; name: string };
  /** Archived members keep their phone; a returning member is restored, not re-added. */
  archived: boolean;
}

export interface MemberDto extends MemberSummaryDto {
  gender: Gender | null;
  source: MemberSource | null;
  notes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  blockedReason: string | null;
  hasPhoto: boolean;
  createdAt: string;
}

export interface MemberDuplicatesDto {
  /** The member who already has this phone; the phone cannot be used again. */
  phoneMatch: MemberSummaryDto | null;
  /** Same first and last name, and the same birth date when one was given. A warning only. */
  similar: MemberSummaryDto[];
}

/** `details` of a MEMBER_PHONE_TAKEN error. */
export interface MemberPhoneTakenDetails {
  member: MemberSummaryDto;
}
