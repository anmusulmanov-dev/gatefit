import { ErrorCode } from '@gatefit/shared';
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { AppException } from '../../common/errors/app.exception';
import { notFound } from '../../common/errors/domain-errors';
import type { Env } from '../../config/env';
import { PLATFORM_KEY, Public } from '../auth/auth.decorators';
import { PlatformSessionService } from './platform-session.service';

const SESSION_COOKIE = 'gf_platform_session';
export const PLATFORM_SESSION_TTL_SECONDS = 12 * 60 * 60;

/** The signed-in platform operator. */
export interface PlatformAdminContext {
  id: string;
  sessionId: string;
}

export interface PlatformRequest extends Request {
  platformAdmin?: PlatformAdminContext;
}

export function platformAdminOf(req: PlatformRequest): PlatformAdminContext {
  if (!req.platformAdmin) {
    throw new Error('platformAdminOf() needs a request authorized with @Platform()');
  }
  return req.platformAdmin;
}

// Strict: the platform panel is never reached by following a link from another site.
function cookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: '/' };
}

export function readPlatformSessionToken(req: Request): string | undefined {
  return (req.cookies as Record<string, string | undefined>)[SESSION_COOKIE];
}

export function setPlatformSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(secure),
    maxAge: PLATFORM_SESSION_TTL_SECONDS * 1000,
  });
}

export function clearPlatformSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions(secure));
}

/**
 * Platform endpoints exist only at the platform's own address (admin.<base domain>).
 * At any organization's address they answer 404, as if they were not there.
 */
@Injectable()
export class PlatformHostGuard implements CanActivate {
  private readonly host: string;

  constructor(config: ConfigService<Env, true>) {
    this.host = `admin.${config.get('APP_BASE_DOMAIN', { infer: true })}`.toLowerCase();
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.hostname.toLowerCase() !== this.host) {
      throw notFound('Resource');
    }
    return true;
  }
}

/** Requires a live platform session and attaches the operator to the request. */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly sessions: PlatformSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PlatformRequest>();
    const admin = await this.sessions.resolve(readPlatformSessionToken(req));
    if (!admin) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    req.platformAdmin = admin;
    return true;
  }
}

/**
 * Marks an endpoint as the platform's: reachable only at the platform address by a
 * signed-in operator. The tenant authentication and permission checks step aside for it.
 */
export const Platform = () =>
  applyDecorators(SetMetadata(PLATFORM_KEY, true), UseGuards(PlatformHostGuard, PlatformAuthGuard));

/** A platform endpoint that needs no session: the platform sign-in itself. */
export const PlatformPublic = () => applyDecorators(Public(), UseGuards(PlatformHostGuard));
