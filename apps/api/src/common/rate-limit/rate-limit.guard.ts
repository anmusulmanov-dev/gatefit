import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Env } from '../../config/env';
import { RateLimiter } from './rate-limiter.service';

const AUTH_RATE_LIMIT_KEY = 'gatefit:auth-rate-limit';

/** Marks a sign-in endpoint: it gets the much stricter per-IP limit on top of the general one. */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

const WINDOW_SECONDS = 60;

/**
 * Per-IP limits for every request. Limits per phone number live in the auth services,
 * next to the action they protect.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ip = context.switchToHttp().getRequest<Request>().ip ?? 'unknown';

    await this.limiter.consume(`ip:${ip}`, {
      limit: this.config.get('RATE_LIMIT_PER_MINUTE', { infer: true }),
      windowSeconds: WINDOW_SECONDS,
    });

    const isAuthEndpoint = this.reflector.getAllAndOverride<boolean | undefined>(
      AUTH_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isAuthEndpoint) {
      await this.limiter.consume(`auth-ip:${ip}`, {
        limit: this.config.get('AUTH_RATE_LIMIT_PER_MINUTE', { infer: true }),
        windowSeconds: WINDOW_SECONDS,
      });
    }
    return true;
  }
}
