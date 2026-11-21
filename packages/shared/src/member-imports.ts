import { z } from 'zod';
import { memberFilterSchema } from './members';

/** Largest member file accepted for import, and largest photo. */
export const MEMBER_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const MEMBER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Most data rows one import may hold. */
export const MEMBER_IMPORT_MAX_ROWS = 10_000;

/** What a column of an imported file can mean. `fullName` is "Last First [Patronymic]". */
export const IMPORT_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'phone',
  'birthDate',
  'gender',
  'source',
  'notes',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Columns of an export, in order; an exported file imports back as it is. */
export const EXPORT_FIELDS = [
  'lastName',
  'firstName',
  'phone',
  'birthDate',
  'gender',
  'status',
  'homeLocation',
  'source',
  'notes',
  'emergencyContactName',
  'emergencyContactPhone',
  'createdAt',
] as const;
export type ExportField = (typeof EXPORT_FIELDS)[number];

export const IMPORT_STATUSES = [
  'uploaded',
  'validated',
  'queued',
  'running',
  'done',
  'failed',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Why a row cannot be imported. Translated in the UI. */
export const IMPORT_ROW_ERRORS = [
  'NAME_REQUIRED',
  'PHONE_REQUIRED',
  'PHONE_INVALID',
  /** The same phone appears on an earlier row of the file. */
  'PHONE_REPEATED',
  /** A member with this phone already exists. */
  'PHONE_EXISTS',
  'BIRTH_DATE_INVALID',
  'GENDER_INVALID',
  'SOURCE_INVALID',
  'TOO_LONG',
] as const;
export type ImportRowError = (typeof IMPORT_ROW_ERRORS)[number];

/** Field → zero-based column index. */
export const importMappingSchema = z
  .partialRecord(z.enum(IMPORT_FIELDS), z.number().int().min(0).max(199))
  .refine((mapping) => mapping.phone !== undefined, 'Map a column to the phone')
  .refine(
    (mapping) =>
      mapping.fullName !== undefined ||
      (mapping.firstName !== undefined && mapping.lastName !== undefined),
    'Map a column to the full name, or columns to the first and last name',
  )
  .refine((mapping) => {
    const columns = Object.values(mapping);
    return new Set(columns).size === columns.length;
  }, 'A column can be mapped to one field only');
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const memberImportValidateSchema = z.object({
  mapping: importMappingSchema,
  /** Where the imported members belong. */
  homeLocationId: z.uuid(),
});
export type MemberImportValidateInput = z.infer<typeof memberImportValidateSchema>;

export const memberExportQuerySchema = memberFilterSchema.extend({
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});
export type MemberExportQuery = z.infer<typeof memberExportQuerySchema>;

export interface ImportRowErrorDto {
  /** One-based row number as a spreadsheet shows it (the header is row 1). */
  row: number;
  field: ImportField | null;
  code: ImportRowError;
}

export interface MemberImportDto {
  id: string;
  status: ImportStatus;
  fileName: string;
  headers: string[];
  /** Suggested from the headers on upload, then what was chosen. */
  mapping: Partial<Record<ImportField, number>>;
  /** The first rows of the file, for the mapping step. */
  sampleRows: string[][];
  homeLocation: { id: string; name: string } | null;
  totalRows: number;
  /** Rows that pass validation; known after `validate`. */
  validRows: number | null;
  /** All problems found; at most the first 1000 are listed in `errors`. */
  errorCount: number;
  errors: ImportRowErrorDto[];
  /** Known when done. Rows valid at validation but taken by then are skipped. */
  createdCount: number | null;
  skippedCount: number | null;
  createdAt: string;
  finishedAt: string | null;
}
