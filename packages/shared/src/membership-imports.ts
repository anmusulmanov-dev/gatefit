import { z } from 'zod';
import type { ImportStatus } from './member-imports';

/**
 * Bringing in memberships that are already running in a gym's old system (docs/TZ.md
 * F-1.4.1): one row per membership, dates as they stand there, no money taken now.
 */

/** Most data rows one membership import may hold. */
export const MEMBERSHIP_IMPORT_MAX_ROWS = 5_000;

/** What a column of a membership file can mean. */
export const MEMBERSHIP_IMPORT_FIELDS = [
  'phone',
  'plan',
  'startsOn',
  'endsOn',
  'visitsLeft',
  'debt',
  'dueOn',
  'location',
] as const;
export type MembershipImportField = (typeof MEMBERSHIP_IMPORT_FIELDS)[number];

/** Why a row cannot be imported. Translated in the UI. */
export const MEMBERSHIP_IMPORT_ROW_ERRORS = [
  'PHONE_REQUIRED',
  'PHONE_INVALID',
  /** No member has this phone (import the members first). */
  'MEMBER_NOT_FOUND',
  'MEMBER_ARCHIVED',
  'PLAN_REQUIRED',
  'PLAN_NOT_FOUND',
  /** Several plans have this name. */
  'PLAN_AMBIGUOUS',
  'DATE_REQUIRED',
  'DATE_INVALID',
  'END_BEFORE_START',
  /** The last day is already behind: only memberships still running are brought in. */
  'ALREADY_ENDED',
  'START_TOO_FAR_AHEAD',
  'VISITS_REQUIRED',
  'VISITS_INVALID',
  /** The plan has unlimited visits. */
  'VISITS_NOT_APPLICABLE',
  'DEBT_INVALID',
  'DUE_DATE_INVALID',
  'LOCATION_NOT_FOUND',
  'LOCATION_NOT_ASSIGNED',
  'PLAN_NOT_AT_LOCATION',
  /** The member has another membership for some of these days (in the system or the file). */
  'OVERLAP',
] as const;
export type MembershipImportRowError = (typeof MEMBERSHIP_IMPORT_ROW_ERRORS)[number];

/** Field → zero-based column index. */
export const membershipImportMappingSchema = z
  .partialRecord(z.enum(MEMBERSHIP_IMPORT_FIELDS), z.number().int().min(0).max(199))
  .refine(
    (mapping) =>
      mapping.phone !== undefined &&
      mapping.plan !== undefined &&
      mapping.startsOn !== undefined &&
      mapping.endsOn !== undefined,
    'Map columns to the phone, the plan and both dates',
  )
  .refine((mapping) => {
    const columns = Object.values(mapping);
    return new Set(columns).size === columns.length;
  }, 'A column can be mapped to one field only');
export type MembershipImportMapping = z.infer<typeof membershipImportMappingSchema>;

export const membershipImportValidateSchema = z.object({
  mapping: membershipImportMappingSchema,
});
export type MembershipImportValidateInput = z.infer<typeof membershipImportValidateSchema>;

export const membershipImportRevertSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type MembershipImportRevertInput = z.infer<typeof membershipImportRevertSchema>;

export interface MembershipImportRowErrorDto {
  /** One-based row number as a spreadsheet shows it (the header is row 1). */
  row: number;
  field: MembershipImportField | null;
  code: MembershipImportRowError;
}

export interface MembershipImportDto {
  id: string;
  status: ImportStatus;
  fileName: string;
  headers: string[];
  /** Suggested from the headers on upload, then what was chosen. */
  mapping: Partial<Record<MembershipImportField, number>>;
  /** The first rows of the file, for the mapping step. */
  sampleRows: string[][];
  totalRows: number;
  /** Rows that pass validation; known after `validate`. */
  validRows: number | null;
  /** Money still owed on the valid rows, in minor units of `currency`. */
  debtMinor: string | null;
  currency: string;
  /** All problems found; at most the first 1000 are listed in `errors`. */
  errorCount: number;
  errors: MembershipImportRowErrorDto[];
  /** Known when done. Rows valid at validation but not by then are skipped. */
  createdCount: number | null;
  skippedCount: number | null;
  createdAt: string;
  finishedAt: string | null;
  /** Set once the import has been undone. */
  revertedAt: string | null;
  revertReason: string | null;
}
