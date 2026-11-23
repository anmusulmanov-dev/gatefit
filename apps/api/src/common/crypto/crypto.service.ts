import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * Symmetric protection for secrets stored in the database, built on DATA_ENCRYPTION_KEY.
 * Each purpose gets its own derived key, so a value made for one use is useless for another.
 */
@Injectable()
export class CryptoService {
  private readonly masterKey: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.masterKey = Buffer.from(config.get('DATA_ENCRYPTION_KEY', { infer: true }), 'base64');
  }

  /** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>`, base64url parts. */
  encrypt(purpose: string, plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.deriveKey(purpose), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** Throws when the value was tampered with or encrypted for another purpose. */
  decrypt(purpose: string, value: string): string {
    const [version, iv, tag, ciphertext] = value.split('.');
    if (version !== VERSION || !iv || !tag || !ciphertext) {
      throw new Error('Malformed encrypted value');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.deriveKey(purpose),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Keyed hash for low-entropy values (SMS codes) that a plain hash would not protect. */
  hmac(purpose: string, value: string): string {
    return createHmac('sha256', this.deriveKey(purpose)).update(value).digest('hex');
  }

  /** Constant-time comparison of two hex digests. */
  digestsEqual(a: string, b: string): boolean {
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  /** 32 bytes derived for one purpose, e.g. the seed of a signing key. Same purpose, same bytes. */
  derive(purpose: string): Buffer {
    return this.deriveKey(purpose);
  }

  private deriveKey(purpose: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.masterKey, Buffer.alloc(0), purpose, 32));
  }
}

@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
