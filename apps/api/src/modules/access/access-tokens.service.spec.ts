import { randomBytes } from 'node:crypto';
import { parseAccessToken } from '@gatefit/shared';
import type { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { Env } from '../../config/env';
import { AccessTokensService } from './access-tokens.service';

const ORG_A = '00000000-0000-7000-8000-00000000000a';
const ORG_B = '00000000-0000-7000-8000-00000000000b';
const MEMBER = '00000000-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-25T05:30:10Z');

function service(key = randomBytes(32).toString('base64')) {
  const config = { get: () => key } as unknown as ConfigService<Env, true>;
  return new AccessTokensService(new CryptoService(config));
}

describe('AccessTokensService', () => {
  it('issues codes on 30-second steps that check out for the member', () => {
    const tokens = service();
    const code = tokens.issue(ORG_A, MEMBER, NOW);
    expect(code.refreshAt).toBe('2026-11-25T05:30:30.000Z');
    expect(code.expiresAt).toBe('2026-11-25T05:31:00.000Z');
    expect(tokens.issue(ORG_A, MEMBER, new Date(NOW.getTime() + 15_000)).token).toBe(code.token);
    expect(tokens.check(ORG_A, code.token, NOW)).toEqual({ ok: true, memberId: MEMBER });
  });

  it('calls a code older than 60 seconds expired, naming the member', () => {
    const tokens = service();
    const code = tokens.issue(ORG_A, MEMBER, NOW);
    expect(tokens.check(ORG_A, code.token, new Date('2026-11-25T05:31:01Z'))).toEqual({
      ok: false,
      reason: 'expired_code',
      memberId: MEMBER,
    });
  });

  it('rejects codes of another organization or another key', () => {
    const tokens = service();
    const code = tokens.issue(ORG_A, MEMBER, NOW);
    expect(tokens.check(ORG_B, code.token, NOW)).toEqual({ ok: false, reason: 'invalid_code' });
    expect(service().check(ORG_A, code.token, NOW)).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('derives the same key from the same secret, so restarts keep codes valid', () => {
    const secret = randomBytes(32).toString('base64');
    const code = service(secret).issue(ORG_A, MEMBER, NOW);
    expect(service(secret).check(ORG_A, code.token, NOW).ok).toBe(true);
    expect(service(secret).publicKey(ORG_A)).toEqual(service(secret).publicKey(ORG_A));
    expect(parseAccessToken(code.token)?.payload.k).toBe(service(secret).publicKey(ORG_A).keyId);
  });
});
