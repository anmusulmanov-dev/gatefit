import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Env } from '../src/config/env';
import { AuthRateLimit, RateLimitGuard } from '../src/common/rate-limit/rate-limit.guard';
import { RateLimiter } from '../src/common/rate-limit/rate-limiter.service';
import { createTestApp, type TestApp } from './support/app';

describe('Rate limiting (integration, Redis)', () => {
  let t: TestApp;
  let limiter: RateLimiter;

  beforeAll(async () => {
    t = await createTestApp();
    limiter = t.app.get(RateLimiter);
  });

  afterAll(async () => {
    await t.app.close();
  });

  describe('RateLimiter', () => {
    it('allows hits up to the limit, then refuses with the time to wait', async () => {
      const key = `test:${randomUUID()}`;
      const limit = { limit: 3, windowSeconds: 30 };

      for (let hit = 0; hit < 3; hit += 1) {
        await limiter.consume(key, limit);
      }
      await expect(limiter.consume(key, limit)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
        details: { retryAfterSeconds: expect.any(Number) as number },
      });
    });

    it('counts keys independently', async () => {
      const limit = { limit: 1, windowSeconds: 30 };
      await limiter.consume(`test:${randomUUID()}`, limit);
      await expect(limiter.consume(`test:${randomUUID()}`, limit)).resolves.toBeUndefined();
    });

    it('starts over after reset', async () => {
      const key = `test:${randomUUID()}`;
      const limit = { limit: 1, windowSeconds: 30 };
      await limiter.consume(key, limit);
      await expect(limiter.consume(key, limit)).rejects.toMatchObject({ status: 429 });

      await limiter.reset(key);
      await expect(limiter.consume(key, limit)).resolves.toBeUndefined();
    });

    it('starts over when the window ends', async () => {
      const key = `test:${randomUUID()}`;
      const limit = { limit: 1, windowSeconds: 1 };
      await limiter.consume(key, limit);
      await expect(limiter.consume(key, limit)).rejects.toMatchObject({ status: 429 });

      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(limiter.consume(key, limit)).resolves.toBeUndefined();
    });
  });

  describe('RateLimitGuard', () => {
    class Routes {}
    const ordinaryHandler = (): void => undefined;
    const signInHandler = (): void => undefined;
    // What @AuthRateLimit() does to a controller method.
    AuthRateLimit()(signInHandler);

    function guardFor(general: number, auth: number): RateLimitGuard {
      const config = {
        get: (name: string) => (name === 'RATE_LIMIT_PER_MINUTE' ? general : auth),
      } as unknown as ConfigService<Env, true>;
      return new RateLimitGuard(limiter, new Reflector(), config);
    }

    function contextFor(handler: () => void, ip: string): ExecutionContext {
      return {
        getHandler: () => handler,
        getClass: () => Routes,
        switchToHttp: () => ({ getRequest: () => ({ ip }) }),
      } as unknown as ExecutionContext;
    }

    it('applies the general limit per IP address', async () => {
      const guard = guardFor(2, 100);
      const ip = `10.0.0.${randomUUID()}`;
      const ordinary = contextFor(ordinaryHandler, ip);

      await expect(guard.canActivate(ordinary)).resolves.toBe(true);
      await expect(guard.canActivate(ordinary)).resolves.toBe(true);
      await expect(guard.canActivate(ordinary)).rejects.toMatchObject({ status: 429 });

      // Another address is unaffected.
      const elsewhere = contextFor(ordinaryHandler, `10.0.1.${randomUUID()}`);
      await expect(guard.canActivate(elsewhere)).resolves.toBe(true);
    });

    it('applies the stricter limit to sign-in endpoints only', async () => {
      const guard = guardFor(100, 1);
      const ip = `10.0.2.${randomUUID()}`;

      await expect(guard.canActivate(contextFor(signInHandler, ip))).resolves.toBe(true);
      await expect(guard.canActivate(contextFor(signInHandler, ip))).rejects.toMatchObject({
        status: 429,
      });
      await expect(guard.canActivate(contextFor(ordinaryHandler, ip))).resolves.toBe(true);
    });
  });
});
