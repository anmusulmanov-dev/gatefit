import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { CryptoService } from './crypto.service';

function createService(keyByte = 1): CryptoService {
  const config = {
    get: () => Buffer.alloc(32, keyByte).toString('base64'),
  } as unknown as ConfigService<Env, true>;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  const service = createService();

  it('round-trips a value', () => {
    const encrypted = service.encrypt('totp', 'JBSWY3DPEHPK3PXP');
    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(service.decrypt('totp', encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a different ciphertext every time', () => {
    expect(service.encrypt('totp', 'same')).not.toBe(service.encrypt('totp', 'same'));
  });

  it('rejects a value encrypted for another purpose', () => {
    expect(() => service.decrypt('other', service.encrypt('totp', 'secret'))).toThrow();
  });

  it('rejects a value encrypted with another key', () => {
    expect(() => createService(2).decrypt('totp', service.encrypt('totp', 'secret'))).toThrow();
  });

  it('rejects a tampered or malformed value', () => {
    const encrypted = service.encrypt('totp', 'secret');
    const tampered = `${encrypted.slice(0, -2)}${encrypted.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(() => service.decrypt('totp', tampered)).toThrow();
    expect(() => service.decrypt('totp', 'garbage')).toThrow(/Malformed/);
  });

  it('hmac is stable, keyed by purpose and comparable in constant time', () => {
    const digest = service.hmac('otp', '123456');
    expect(digest).toBe(service.hmac('otp', '123456'));
    expect(digest).not.toBe(service.hmac('other', '123456'));
    expect(service.digestsEqual(digest, service.hmac('otp', '123456'))).toBe(true);
    expect(service.digestsEqual(digest, service.hmac('otp', '654321'))).toBe(false);
    expect(service.digestsEqual(digest, 'abcd')).toBe(false);
  });
});
