import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto';
import {
  type AccessTokenPayload,
  accessTokenFresh,
  accessTokenSigningInput,
  base64Url,
  parseAccessToken,
  QR_REFRESH_SECONDS,
  QR_UPCOMING,
  QR_VALID_SECONDS,
  type QrTokenDto,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';

/** DER prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows. */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

interface OrganizationKey {
  id: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Raw 32 bytes, base64url: what reception screens use to check codes offline. */
  publicKeyRaw: string;
}

export type TokenCheck =
  | { ok: true; memberId: string }
  /** Not a code of ours, signed by another key or for another organization. */
  | { ok: false; reason: 'invalid_code' }
  /** Genuine but too old (a screenshot): the member is known. */
  | { ok: false; reason: 'expired_code'; memberId: string };

/**
 * Signs and checks member QR codes (docs/ADR/0010-access.md). Each organization has its
 * own Ed25519 key, derived from DATA_ENCRYPTION_KEY, so nothing is stored and a reception
 * screen can check codes offline with the public key alone: it cannot make new ones.
 */
@Injectable()
export class AccessTokensService {
  private readonly keys = new Map<string, OrganizationKey>();

  constructor(private readonly crypto: CryptoService) {}

  /**
   * The current code and the next ones. Codes are issued on 30-second steps, like TOTP:
   * asking again within a step gives the same code. A code made for a later step is valid
   * only from that step on, so handing them out early lets a phone without signal keep
   * showing a working code for a while, and nothing more.
   */
  issue(organizationId: string, memberId: string, now: Date): QrTokenDto {
    const step = Math.floor(now.getTime() / 1000 / QR_REFRESH_SECONDS) * QR_REFRESH_SECONDS;
    const at = (seconds: number) => new Date(seconds * 1000).toISOString();
    return {
      token: this.sign(organizationId, memberId, step),
      refreshAt: at(step + QR_REFRESH_SECONDS),
      expiresAt: at(step + QR_VALID_SECONDS),
      upcoming: Array.from({ length: QR_UPCOMING }, (_, index) => {
        const next = step + (index + 1) * QR_REFRESH_SECONDS;
        return {
          token: this.sign(organizationId, memberId, next),
          validFrom: at(next),
          expiresAt: at(next + QR_VALID_SECONDS),
        };
      }),
    };
  }

  private sign(organizationId: string, memberId: string, issuedAt: number): string {
    const key = this.keyOf(organizationId);
    const payload: AccessTokenPayload = { o: organizationId, m: memberId, i: issuedAt, k: key.id };
    const input = accessTokenSigningInput(payload);
    return `${input}.${base64Url.encode(sign(null, Buffer.from(input), key.privateKey))}`;
  }

  check(organizationId: string, token: string, now: Date): TokenCheck {
    const parsed = parseAccessToken(token);
    const key = this.keyOf(organizationId);
    if (
      !parsed ||
      parsed.payload.o !== organizationId ||
      parsed.payload.k !== key.id ||
      !verify(null, Buffer.from(parsed.signingInput), key.publicKey, parsed.signature)
    ) {
      return { ok: false, reason: 'invalid_code' };
    }
    if (!accessTokenFresh(parsed.payload.i, now)) {
      return { ok: false, reason: 'expired_code', memberId: parsed.payload.m };
    }
    return { ok: true, memberId: parsed.payload.m };
  }

  publicKey(organizationId: string): { keyId: string; publicKey: string } {
    const key = this.keyOf(organizationId);
    return { keyId: key.id, publicKey: key.publicKeyRaw };
  }

  private keyOf(organizationId: string): OrganizationKey {
    let key = this.keys.get(organizationId);
    if (!key) {
      const seed = this.crypto.derive(`access-qr-signing:${organizationId}`);
      const privateKey = createPrivateKey({
        key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
        format: 'der',
        type: 'pkcs8',
      });
      const publicKey = createPublicKey(privateKey);
      // The SPKI encoding of an Ed25519 key ends with the raw 32 bytes.
      const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
      key = {
        id: createHash('sha256').update(raw).digest('base64url').slice(0, 8),
        privateKey,
        publicKey,
        publicKeyRaw: raw.toString('base64url'),
      };
      this.keys.set(organizationId, key);
    }
    return key;
  }
}
