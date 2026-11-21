import { Global, Injectable, Module } from '@nestjs/common';
import { z } from 'zod';
import { Clock } from '../clock/clock';
import { CryptoService } from '../crypto/crypto.service';

const LINK_PURPOSE = 'file-link';
/** How long a link handed to a browser works. */
export const FILE_LINK_TTL_SECONDS = 60 * 60;

const payloadSchema = z.object({ k: z.string().min(1), e: z.number().int() });

/**
 * Short-lived signed links to stored files (docs/TZ.md section 9). A link names one file
 * and an expiry; the API checks the signature and streams the file, so the storage
 * service itself is never exposed. Whoever is given a link may open it until it expires.
 */
@Injectable()
export class FileLinksService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
  ) {}

  /** A path under the API, e.g. `/api/v1/files/<token>`. */
  link(key: string, ttlSeconds = FILE_LINK_TTL_SECONDS): string {
    // Rounded up to a whole TTL window, so the same file gets the same link for a while
    // and browsers can cache it.
    const now = this.clock.nowSeconds();
    const expires = (Math.floor(now / ttlSeconds) + 2) * ttlSeconds;
    const payload = Buffer.from(JSON.stringify({ k: key, e: expires })).toString('base64url');
    return `/api/v1/files/${payload}.${this.sign(payload)}`;
  }

  /** The file key of a valid, unexpired token; null otherwise. */
  verify(token: string): string | null {
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length > 0 || !/^[0-9a-f]{64}$/.test(signature)) {
      return null;
    }
    if (!this.crypto.digestsEqual(signature, this.sign(payload))) {
      return null;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    const parsed = payloadSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.e <= this.clock.nowSeconds()) {
      return null;
    }
    return parsed.data.k;
  }

  private sign(payload: string): string {
    return this.crypto.hmac(LINK_PURPOSE, payload);
  }
}

@Global()
@Module({ providers: [FileLinksService], exports: [FileLinksService] })
export class FileLinksModule {}
