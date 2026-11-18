import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Clock } from '../../common/clock/clock';
import { RedisService } from '../../common/redis/redis.service';
import { TOTP_TOLERANCE_SECONDS } from './auth.constants';

const ISSUER = 'Gatefit';
// Longer than the window in which a code is accepted (one step each side of now).
const REPLAY_TTL_SECONDS = 120;

/** Time-based one-time passwords (RFC 6238), as produced by authenticator apps. */
@Injectable()
export class TotpService {
  constructor(
    private readonly clock: Clock,
    private readonly redis: RedisService,
  ) {}

  /** A new base32 secret and the otpauth:// URI an authenticator app scans. */
  createSecret(label: string): { secret: string; otpauthUrl: string } {
    const secret = generateSecret();
    return { secret, otpauthUrl: generateURI({ issuer: ISSUER, label, secret }) };
  }

  /**
   * Checks a code. Each code is accepted once per user: someone who watched it being
   * typed cannot use it again within its lifetime.
   */
  async verify(userId: string, secret: string, code: string): Promise<boolean> {
    let valid: boolean;
    try {
      valid = verifySync({
        secret,
        token: code,
        epoch: this.clock.nowSeconds(),
        epochTolerance: TOTP_TOLERANCE_SECONDS,
      }).valid;
    } catch {
      valid = false;
    }
    if (!valid) {
      return false;
    }

    const firstUse = await this.redis.client.set(
      `gf:totp-used:${userId}:${code}`,
      '1',
      'EX',
      REPLAY_TTL_SECONDS,
      'NX',
    );
    return firstUse === 'OK';
  }
}
