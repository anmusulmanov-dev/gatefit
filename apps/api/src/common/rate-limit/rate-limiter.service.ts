import { ErrorCode } from '@gatefit/shared';
import { Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { AppException } from '../errors/app.exception';
import { RedisService } from '../redis/redis.service';

// Counts a hit and starts the window on the first one, atomically.
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('TTL', KEYS[1]) }
`;

export interface RateLimit {
  limit: number;
  windowSeconds: number;
}

/** Fixed-window counter in Redis, shared by all API instances. */
@Injectable()
export class RateLimiter {
  private readonly prefix: string;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    // Tests share Redis with development; keep their counters apart.
    this.prefix = `gf:${config.get('NODE_ENV', { infer: true })}:rl:`;
  }

  /** Records one hit for `key`. Throws 429 with the seconds to wait once over the limit. */
  async consume(key: string, { limit, windowSeconds }: RateLimit): Promise<void> {
    const [count, ttl] = (await this.redis.client.eval(
      CONSUME_SCRIPT,
      1,
      this.prefix + key,
      windowSeconds,
    )) as [number, number];

    if (count > limit) {
      throw new AppException(
        ErrorCode.RATE_LIMITED,
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds: Math.max(ttl, 1) },
      );
    }
  }

  /** Forgets the hits for `key`: used after a success, so only failures add up. */
  async reset(key: string): Promise<void> {
    await this.redis.client.del(this.prefix + key);
  }
}

@Global()
@Module({ providers: [RateLimiter], exports: [RateLimiter] })
export class RateLimitModule {}
