import { z } from 'zod';

export const ORGANIZATION_LOCALES = ['uz', 'ru', 'en'] as const;

const nameSchema = z.string().trim().min(1).max(120);

// Country and currency are deliberately absent: only the platform may change them.
export const organizationUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    locale: z.enum(ORGANIZATION_LOCALES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  locale: string;
  status: 'trial' | 'active' | 'blocked';
  trialEndsAt: string | null;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');

const dayHours = z
  .object({ open: timeOfDay, close: timeOfDay })
  .refine((hours) => hours.open !== hours.close, 'Opening and closing time must differ');

/** Opening hours per weekday in the location's own time zone; null means closed that day. */
export const workingHoursSchema = z.object({
  mon: dayHours.nullable(),
  tue: dayHours.nullable(),
  wed: dayHours.nullable(),
  thu: dayHours.nullable(),
  fri: dayHours.nullable(),
  sat: dayHours.nullable(),
  sun: dayHours.nullable(),
});
export type WorkingHours = z.infer<typeof workingHoursSchema>;

/** An IANA zone known to the runtime, e.g. Asia/Tashkent. */
export const timezoneSchema = z
  .string()
  .refine((zone) => Intl.supportedValuesOf('timeZone').includes(zone), 'Unknown time zone');

export const locationCreateSchema = z.object({
  name: nameSchema,
  address: z.string().trim().max(300).nullish(),
  timezone: timezoneSchema,
  workingHours: workingHoursSchema.nullish(),
});
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;

export const locationUpdateSchema = locationCreateSchema
  .partial()
  // Archiving hides a location without deleting its history; it can be restored.
  .extend({ archived: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;

export const locationListQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export interface LocationDto {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  workingHours: WorkingHours | null;
  archived: boolean;
}
