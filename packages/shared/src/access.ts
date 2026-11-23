import { z } from 'zod';
import { pageQuerySchema } from './pagination';
import type { EntryMembership } from './access-rules';
import type { PlanType } from './plans';

// Entry control (docs/TZ.md F-3.1 to F-3.4). A member's phone shows a QR code that the
// server signs (Ed25519) and replaces every 30 seconds; the reception screen scans it.

/** How long a QR code is shown before the app fetches the next one. */
export const QR_REFRESH_SECONDS = 30;
/** A code older than this is refused, so a screenshot stops working (acceptance criterion 5). */
export const QR_VALID_SECONDS = 60;
/** Tolerated clock difference for codes that seem to come from the future. */
export const QR_CLOCK_SKEW_SECONDS = 5;
/** A second scan of the same member at the same desk within this window is not a new visit. */
export const REPEAT_SCAN_SECONDS = 5 * 60;
/** Someone who checked in counts as inside for this long unless staff mark them out. */
export const OCCUPANCY_HOURS = 3;

export const CHECK_IN_DIRECTIONS = ['in', 'out'] as const;
export type CheckInDirection = (typeof CHECK_IN_DIRECTIONS)[number];

/** `qr_offline`: checked by the reception screen while the internet was down, sent later. */
export const CHECK_IN_METHODS = ['qr', 'manual', 'qr_offline'] as const;
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];

export const CHECK_IN_RESULTS = ['allowed', 'denied'] as const;
export type CheckInResult = (typeof CHECK_IN_RESULTS)[number];

/** Why entry was refused; the reception screen shows each one in words. */
export const ACCESS_DENY_REASONS = [
  'invalid_code',
  'expired_code',
  'member_not_found',
  'member_blocked',
  'debt',
  'no_membership',
  'membership_expired',
  'membership_not_started',
  'membership_frozen',
  'wrong_location',
  'wrong_day',
  'outside_hours',
  'daily_limit',
] as const;
export type AccessDenyReason = (typeof ACCESS_DENY_REASONS)[number];

// --- the QR token ---

export const ACCESS_TOKEN_PREFIX = 'gf1';

/** What a QR code says: whose it is and when it was issued. */
export interface AccessTokenPayload {
  /** Organization id. */
  o: string;
  /** Member id. */
  m: string;
  /** Issued at, Unix seconds. */
  i: number;
  /** Signing key id, so a rotated key is recognised. */
  k: string;
}

const tokenPayloadSchema = z.object({
  o: z.uuid(),
  m: z.uuid(),
  i: z.number().int().positive(),
  k: z.string().min(1).max(32),
});

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    return null;
  }
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export const base64Url = { encode: toBase64Url, decode: fromBase64Url };

/** The text that is signed: `gf1.<payload>`. */
export function accessTokenSigningInput(payload: AccessTokenPayload): string {
  const json = JSON.stringify({ o: payload.o, m: payload.m, i: payload.i, k: payload.k });
  return `${ACCESS_TOKEN_PREFIX}.${toBase64Url(new TextEncoder().encode(json))}`;
}

/** Splits a scanned code into what was signed and the signature; null when it is not ours. */
export function parseAccessToken(
  token: string,
): { payload: AccessTokenPayload; signingInput: string; signature: Uint8Array } | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== ACCESS_TOKEN_PREFIX) {
    return null;
  }
  const [, encodedPayload = '', encodedSignature = ''] = parts;
  const json = fromBase64Url(encodedPayload);
  const signature = fromBase64Url(encodedSignature);
  if (!json || !signature || signature.length !== 64) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
  const parsed = tokenPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return {
    payload: parsed.data,
    signingInput: `${ACCESS_TOKEN_PREFIX}.${encodedPayload}`,
    signature,
  };
}

/** Whether a code issued at `issuedAt` (Unix seconds) is still accepted at `now`. */
export function accessTokenFresh(issuedAt: number, now: Date): boolean {
  const seconds = now.getTime() / 1000;
  return issuedAt <= seconds + QR_CLOCK_SKEW_SECONDS && seconds - issuedAt <= QR_VALID_SECONDS;
}

// --- requests ---

const reasonSchema = z.string().trim().min(1).max(500);

export const accessVerifySchema = z.object({
  token: z.string().trim().min(1).max(1000),
  locationId: z.uuid(),
});
export type AccessVerifyInput = z.infer<typeof accessVerifySchema>;

/** Staff let a member in by hand (the phone is dead, the code will not scan): a reason is required. */
export const accessManualSchema = z.object({
  memberId: z.uuid(),
  locationId: z.uuid(),
  reason: reasonSchema,
});
export type AccessManualInput = z.infer<typeof accessManualSchema>;

export const accessExitSchema = z.object({
  memberId: z.uuid(),
  locationId: z.uuid(),
});
export type AccessExitInput = z.infer<typeof accessExitSchema>;

export const checkInListQuerySchema = pageQuerySchema.extend({
  locationId: z.uuid().optional(),
  memberId: z.uuid().optional(),
  result: z.enum(CHECK_IN_RESULTS).optional(),
  /** Instants (ISO); the client computes day bounds in the location's time zone. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type CheckInListQuery = z.infer<typeof checkInListQuerySchema>;

export const locationQuerySchema = z.object({ locationId: z.uuid() });
export type LocationQuery = z.infer<typeof locationQuerySchema>;

/** Most entries a reception screen may send in one sync after being offline. */
export const OFFLINE_SYNC_MAX = 500;
/** Entries older than this are not accepted from a reception screen. */
export const OFFLINE_SYNC_MAX_AGE_HOURS = 48;

export const offlineCheckInSchema = z.object({
  /** Made by the screen, so a resent batch is not recorded twice. */
  id: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  memberId: z.uuid(),
  membershipId: z.uuid().nullable(),
  result: z.enum(CHECK_IN_RESULTS),
  denyReason: z.enum(ACCESS_DENY_REASONS).nullable(),
});
export type OfflineCheckIn = z.infer<typeof offlineCheckInSchema>;

export const accessSyncSchema = z.object({
  locationId: z.uuid(),
  checkIns: z.array(offlineCheckInSchema).min(1).max(OFFLINE_SYNC_MAX),
});
export type AccessSyncInput = z.infer<typeof accessSyncSchema>;

// --- responses ---

/** How many codes after the current one /me/qr hands out, for a phone that loses signal. */
export const QR_UPCOMING = 4;

export interface UpcomingQrDto {
  token: string;
  /** Show it from this moment (the previous one's refresh time). */
  validFrom: string;
  expiresAt: string;
}

export interface QrTokenDto {
  token: string;
  /** When the app should show the next code. */
  refreshAt: string;
  /** When this code stops working. */
  expiresAt: string;
  /** The next codes, in order: the app shows them without a network (about 2.5 minutes). */
  upcoming: UpcomingQrDto[];
}

export interface AccessMemberDto {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

export interface AccessMembershipDto {
  id: string;
  planName: string;
  planType: PlanType;
  endsOn: string;
  daysLeft: number | null;
  /** After this visit; null for unlimited. */
  visitsLeft: number | null;
}

export interface AccessResultDto {
  allowed: boolean;
  reason: AccessDenyReason | null;
  /** Null only when the code could not be read at all. */
  member: AccessMemberDto | null;
  membership: AccessMembershipDto | null;
  /** The recorded entry; null for an unreadable code. */
  checkInId: string | null;
  /** The same member was let in here a moment ago: no new visit was counted. */
  repeat: boolean;
}

export interface CheckInDto {
  id: string;
  at: string;
  location: { id: string; name: string };
  member: { id: string; firstName: string; lastName: string };
  membershipId: string | null;
  direction: CheckInDirection;
  method: CheckInMethod;
  result: CheckInResult;
  denyReason: AccessDenyReason | null;
  /** Why staff let the member in by hand. */
  note: string | null;
}

export interface OccupancyDto {
  locationId: string;
  count: number;
}

/** What the live feed of a reception screen sends. */
export interface AccessEventDto {
  checkIn: CheckInDto;
  occupancy: OccupancyDto;
}

/** A membership as the reception screen needs it to decide on its own when offline. */
export type OfflineMembershipDto = EntryMembership;

export interface OfflineMemberDto {
  id: string;
  firstName: string;
  lastName: string;
  /** Blocked members and debtors are refused offline too. */
  status: string;
  memberships: OfflineMembershipDto[];
}

export interface OfflineSnapshotDto {
  generatedAt: string;
  location: { id: string; name: string; timezone: string };
  /** Ed25519 public key, raw 32 bytes, base64url. */
  publicKey: string;
  keyId: string;
  members: OfflineMemberDto[];
}

export interface AccessSyncResultDto {
  /** Entries recorded now. */
  recorded: number;
  /** Entries already received earlier. */
  duplicates: number;
}
