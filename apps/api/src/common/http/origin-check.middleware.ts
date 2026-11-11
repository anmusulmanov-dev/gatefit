import { ErrorCode } from '@gatefit/shared';
import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../../config/env';
import { AppException } from '../errors/app.exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie authentication. Browsers attach an Origin header to every
 * state-changing request; it must be the host being called or an explicitly allowed
 * origin. Non-browser clients send no Origin and are not affected.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(config: ConfigService<Env, true>) {
    this.allowedOrigins = new Set(config.get('CORS_ORIGINS', { infer: true }));
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    const origin = req.headers.origin;
    if (SAFE_METHODS.has(req.method) || !origin || this.isAllowed(origin, req)) {
      next();
      return;
    }
    throw new AppException(
      ErrorCode.FORBIDDEN,
      'Cross-site request rejected',
      HttpStatus.FORBIDDEN,
    );
  }

  private isAllowed(origin: string, req: Request): boolean {
    if (this.allowedOrigins.has(origin)) {
      return true;
    }
    try {
      // req.host includes the port and honours X-Forwarded-Host only when TRUST_PROXY is on.
      return new URL(origin).host === req.host;
    } catch {
      return false;
    }
  }
}
