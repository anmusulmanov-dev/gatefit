import {
  accessTokenSigningInput,
  base64Url,
  type OfflineCheckIn,
  type OfflineSnapshotDto,
} from './access';
import { checkTokenOffline, decideOffline, uuidv7 } from './access-offline';
import { NO_RESTRICTIONS } from './plans';

const ORG = '00000000-0000-7000-8000-00000000000a';
const MEMBER = '00000000-0000-7000-8000-000000000001';
const STRANGER = '00000000-0000-7000-8000-000000000009';
const LOCATION = '00000000-0000-7000-8000-0000000000aa';
// 2026-11-25 10:30 in Tashkent.
const NOW = new Date('2026-11-25T05:30:10Z');

// WebCrypto, as in the browser: the same API the reception screen verifies with.
const newKeys = () =>
  globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);

let privateKey: CryptoKey;
const KEY = { publicKey: '', keyId: 'key1' };

beforeAll(async () => {
  const keys = await newKeys();
  privateKey = keys.privateKey;
  KEY.publicKey = base64Url.encode(
    new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', keys.publicKey)),
  );
});

async function tokenFor(
  memberId: string,
  issuedAt: Date,
  keyId = KEY.keyId,
  key: CryptoKey = privateKey,
): Promise<string> {
  const input = accessTokenSigningInput({
    o: ORG,
    m: memberId,
    i: Math.floor(issuedAt.getTime() / 1000),
    k: keyId,
  });
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'Ed25519' },
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64Url.encode(new Uint8Array(signature))}`;
}

function snapshot(
  visitsLeft: number | null = null,
  dailyVisitLimit: number | null = null,
): OfflineSnapshotDto {
  return {
    generatedAt: NOW.toISOString(),
    location: { id: LOCATION, name: 'One', timezone: 'Asia/Tashkent' },
    ...KEY,
    members: [
      {
        id: MEMBER,
        firstName: 'Aziz',
        lastName: 'Karimov',
        status: 'active',
        memberships: [
          {
            id: 'm1',
            planName: 'Monthly',
            planType: visitsLeft === null ? 'duration' : 'visits',
            startsOn: '2026-11-01',
            endsOn: '2026-11-30',
            visitsLeft,
            timeZone: 'Asia/Tashkent',
            restrictions: { ...NO_RESTRICTIONS, dailyVisitLimit },
            freezes: [],
          },
        ],
      },
    ],
  };
}

describe('uuidv7', () => {
  it('makes time-ordered UUIDs of version 7', () => {
    const early = uuidv7(new Date('2026-01-01T00:00:00Z'));
    const late = uuidv7(new Date('2026-06-01T00:00:00Z'));
    expect(early).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(early < late).toBe(true);
  });
});

describe('checkTokenOffline', () => {
  it('accepts a fresh code signed with the organization key', async () => {
    expect(await checkTokenOffline(await tokenFor(MEMBER, NOW), KEY, NOW)).toEqual({
      ok: true,
      memberId: MEMBER,
    });
  });

  it('calls a code older than 60 seconds expired', async () => {
    const old = new Date(NOW.getTime() - 61_000);
    expect(await checkTokenOffline(await tokenFor(MEMBER, old), KEY, NOW)).toEqual({
      ok: false,
      reason: 'expired_code',
      memberId: MEMBER,
    });
  });

  it('rejects another key, a forged signature and garbage', async () => {
    const other = (await newKeys()).privateKey;
    expect((await checkTokenOffline(await tokenFor(MEMBER, NOW, 'key1', other), KEY, NOW)).ok).toBe(
      false,
    );
    expect((await checkTokenOffline(await tokenFor(MEMBER, NOW, 'key2'), KEY, NOW)).ok).toBe(false);
    expect((await checkTokenOffline('hello', KEY, NOW)).ok).toBe(false);
  });
});

describe('decideOffline', () => {
  it('lets a member in and queues the entry', async () => {
    const { result, checkIn } = await decideOffline(
      snapshot(),
      await tokenFor(MEMBER, NOW),
      [],
      NOW,
    );
    expect(result).toMatchObject({ allowed: true, member: { firstName: 'Aziz' }, repeat: false });
    expect(checkIn).toMatchObject({ memberId: MEMBER, membershipId: 'm1', result: 'allowed' });
    expect(result.checkInId).toBe(checkIn?.id);
  });

  it('treats a scan right after an entry as a repeat, recording nothing', async () => {
    const first = await decideOffline(snapshot(), await tokenFor(MEMBER, NOW), [], NOW);
    const queued = [first.checkIn as OfflineCheckIn];
    const later = new Date(NOW.getTime() + 60_000);
    const again = await decideOffline(snapshot(), await tokenFor(MEMBER, later), queued, later);
    expect(again).toMatchObject({ result: { allowed: true, repeat: true }, checkIn: null });
  });

  it('spends visits and counts the daily limit from the queue', async () => {
    const first = await decideOffline(snapshot(1), await tokenFor(MEMBER, NOW), [], NOW);
    expect(first.result.membership?.visitsLeft).toBe(0);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const second = await decideOffline(
      snapshot(1),
      await tokenFor(MEMBER, later),
      [first.checkIn as OfflineCheckIn],
      later,
    );
    expect(second.result.reason).toBe('membership_expired');

    const limited = await decideOffline(
      snapshot(null, 1),
      await tokenFor(MEMBER, later),
      [first.checkIn as OfflineCheckIn],
      later,
    );
    expect(limited.result.reason).toBe('daily_limit');
  });

  it('refuses expired codes and members not in the snapshot, queuing the refusal', async () => {
    const old = await decideOffline(
      snapshot(),
      await tokenFor(MEMBER, new Date(NOW.getTime() - 90_000)),
      [],
      NOW,
    );
    expect(old).toMatchObject({
      result: { allowed: false, reason: 'expired_code', member: { id: MEMBER } },
      checkIn: { result: 'denied', denyReason: 'expired_code' },
    });
    const stranger = await decideOffline(snapshot(), await tokenFor(STRANGER, NOW), [], NOW);
    expect(stranger.result.reason).toBe('no_membership');
  });

  it('records nothing for an unreadable code', async () => {
    expect(await decideOffline(snapshot(), 'nonsense', [], NOW)).toMatchObject({
      result: { reason: 'invalid_code' },
      checkIn: null,
    });
  });
});
