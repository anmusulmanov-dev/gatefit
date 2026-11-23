import {
  type AccessResultDto,
  accessTokenFresh,
  base64Url,
  type OfflineCheckIn,
  type OfflineSnapshotDto,
  parseAccessToken,
  REPEAT_SCAN_SECONDS,
} from './access';
import { decideEntry, type EntryMembership, entryDaysLeft } from './access-rules';
import { localDate, startOfLocalDay } from './dates';

// The reception screen's own decision while the internet is down (docs/TZ.md acceptance
// criterion 11, docs/ADR/0010-access.md): the code's signature is checked with the
// organization's public key, the rules are the same as the API's, and the entries wait in
// a queue until they can be sent.

/** A UUID v7 (time-ordered), so entries made offline sort among the others. */
export function uuidv7(now: Date = new Date()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let ms = now.getTime();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type OfflineTokenCheck =
  | { ok: true; memberId: string }
  | { ok: false; reason: 'invalid_code' }
  | { ok: false; reason: 'expired_code'; memberId: string };

/** Checks a scanned code against the organization's Ed25519 public key (raw, base64url). */
export async function checkTokenOffline(
  token: string,
  key: { publicKey: string; keyId: string },
  now: Date,
): Promise<OfflineTokenCheck> {
  const parsed = parseAccessToken(token);
  const raw = base64Url.decode(key.publicKey);
  if (!parsed || !raw || parsed.payload.k !== key.keyId) {
    return { ok: false, reason: 'invalid_code' };
  }
  let valid: boolean;
  try {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      raw as Uint8Array<ArrayBuffer>,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    valid = await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      cryptoKey,
      parsed.signature as Uint8Array<ArrayBuffer>,
      new TextEncoder().encode(parsed.signingInput),
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, reason: 'invalid_code' };
  }
  if (!accessTokenFresh(parsed.payload.i, now)) {
    return { ok: false, reason: 'expired_code', memberId: parsed.payload.m };
  }
  return { ok: true, memberId: parsed.payload.m };
}

export interface OfflineDecision {
  result: AccessResultDto;
  /** The entry to queue; null when nothing is recorded (unreadable code, repeat scan). */
  checkIn: OfflineCheckIn | null;
}

/**
 * Decides on a scanned code with no internet. `queued` are the entries this screen made
 * since its snapshot: they count towards today's visits and spend visits, and a scan right
 * after an entry is a repeat, as online.
 */
export async function decideOffline(
  snapshot: OfflineSnapshotDto,
  token: string,
  queued: readonly OfflineCheckIn[],
  now: Date,
): Promise<OfflineDecision> {
  const check = await checkTokenOffline(token, snapshot, now);
  if (!check.ok && check.reason === 'invalid_code') {
    return { result: refused('invalid_code'), checkIn: null };
  }
  const member = snapshot.members.find((item) => item.id === check.memberId);
  const memberDto = member && {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    photoUrl: null,
  };
  const record = (
    result: 'allowed' | 'denied',
    reason: OfflineCheckIn['denyReason'],
    membershipId: string | null,
  ): OfflineCheckIn => ({
    id: uuidv7(now),
    at: now.toISOString(),
    memberId: check.memberId,
    membershipId,
    result,
    denyReason: reason,
  });

  if (!check.ok) {
    const checkIn = record('denied', 'expired_code', null);
    return {
      result: { ...refused('expired_code'), member: memberDto ?? null, checkInId: checkIn.id },
      checkIn,
    };
  }
  if (!member) {
    // Not in the snapshot: no membership valid here (or not a member at all).
    const checkIn = record('denied', 'no_membership', null);
    return { result: { ...refused('no_membership'), checkInId: checkIn.id }, checkIn };
  }

  const mine = queued.filter((item) => item.memberId === member.id && item.result === 'allowed');
  const repeat = mine.find(
    (item) => now.getTime() - new Date(item.at).getTime() < REPEAT_SCAN_SECONDS * 1000,
  );
  const tz = snapshot.location.timezone;
  const dayStart = startOfLocalDay(localDate(now, tz), tz).getTime();
  const memberships: EntryMembership[] = member.memberships.map((membership) => {
    const spent = mine.filter((item) => item.membershipId === membership.id).length;
    return membership.visitsLeft === null
      ? membership
      : { ...membership, visitsLeft: Math.max(0, membership.visitsLeft - spent) };
  });
  if (repeat) {
    const membership = memberships.find((item) => item.id === repeat.membershipId) ?? null;
    return {
      result: {
        allowed: true,
        reason: null,
        member: memberDto ?? null,
        membership: membership && membershipDto(membership, now),
        checkInId: repeat.id,
        repeat: true,
      },
      checkIn: null,
    };
  }

  const decision = decideEntry(member.status, memberships, {
    locationId: snapshot.location.id,
    locationTimeZone: tz,
    now,
    visitsToday: (membershipId) =>
      mine.filter(
        (item) => item.membershipId === membershipId && new Date(item.at).getTime() >= dayStart,
      ).length,
  });
  if (!decision.allowed) {
    const checkIn = record('denied', decision.reason, null);
    return {
      result: { ...refused(decision.reason), member: memberDto ?? null, checkInId: checkIn.id },
      checkIn,
    };
  }
  const chosen = decision.membership;
  const after =
    chosen.visitsLeft === null ? chosen : { ...chosen, visitsLeft: chosen.visitsLeft - 1 };
  const checkIn = record('allowed', null, chosen.id);
  return {
    result: {
      allowed: true,
      reason: null,
      member: memberDto ?? null,
      membership: membershipDto(after, now),
      checkInId: checkIn.id,
      repeat: false,
    },
    checkIn,
  };
}

function refused(reason: AccessResultDto['reason']): AccessResultDto {
  return { allowed: false, reason, member: null, membership: null, checkInId: null, repeat: false };
}

function membershipDto(membership: EntryMembership, now: Date): AccessResultDto['membership'] {
  return {
    id: membership.id,
    planName: membership.planName,
    planType: membership.planType,
    endsOn: membership.endsOn,
    daysLeft: entryDaysLeft(membership, now),
    visitsLeft: membership.visitsLeft,
  };
}
