import { z } from 'zod';
import { newPasswordSchema, phoneSchema } from './auth';
import { pageQuerySchema } from './pagination';
import { type Permission, PERMISSIONS } from './permissions';

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const permissionsSchema = z
  .array(z.enum(PERMISSIONS))
  .max(PERMISSIONS.length)
  .transform((permissions) => [...new Set(permissions)]);

const roleNameSchema = z.string().trim().min(1).max(60);

export const roleCreateSchema = z.object({
  name: roleNameSchema,
  permissions: permissionsSchema,
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z
  .object({
    name: roleNameSchema.optional(),
    permissions: permissionsSchema.optional(),
    /** Archiving retires a role; it is refused while staff still hold it. */
    archived: z.literal(true).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

export interface RoleDto {
  id: string;
  name: string;
  /** Standard roles ship with the product and cannot be edited. */
  isSystem: boolean;
  permissions: Permission[];
  /** Active staff holding the role. */
  staffCount: number;
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const personNameSchema = z.string().trim().min(1).max(80);
const positionSchema = z.string().trim().max(120);
const locationIdsSchema = z
  .array(z.uuid())
  .max(200)
  .transform((ids) => [...new Set(ids)]);

export const staffCreateSchema = z.object({
  phone: phoneSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
  position: positionSchema.nullish(),
  roleId: z.uuid(),
  locationIds: locationIdsSchema.default([]),
  /** Chosen by whoever adds the staff member; it must be replaced at first sign-in. */
  temporaryPassword: newPasswordSchema,
});
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const staffUpdateSchema = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    position: positionSchema.nullable().optional(),
    roleId: z.uuid().optional(),
    locationIds: locationIdsSchema.optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

export const staffListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
});
export type StaffListQuery = z.infer<typeof staffListQuerySchema>;

export const staffPasswordResetSchema = z.object({ temporaryPassword: newPasswordSchema });
export type StaffPasswordResetInput = z.infer<typeof staffPasswordResetSchema>;

export interface StaffDto {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  position: string | null;
  status: 'active' | 'inactive';
  role: { id: string; name: string; isSystem: boolean };
  locations: { id: string; name: string }[];
  totpEnabled: boolean;
  /** True until the staff member replaces a password chosen by someone else. */
  mustChangePassword: boolean;
}
