import { CLIENT_HEADER, type SessionAudience } from '@gatefit/shared';
import type { CookieOptions, Request, Response } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

// The refresh token is sent only to the auth endpoints, never with ordinary requests.
const REFRESH_PATH = '/api/v1/auth';

// Staff and member apps keep separate cookie pairs, so one browser can hold both sessions
// on the same host (they share one during development).
const accessCookie = (audience: SessionAudience) => `gf_${audience}_access`;
const refreshCookie = (audience: SessionAudience) => `gf_${audience}_refresh`;

function baseOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax' };
}

/** Which app is calling. Anything but an explicit "member" is the staff panel. */
export function clientAudience(req: Request): SessionAudience {
  return req.headers[CLIENT_HEADER] === 'member' ? 'member' : 'staff';
}

export function readAccessToken(req: Request, audience: SessionAudience): string | undefined {
  return (req.cookies as Record<string, string | undefined>)[accessCookie(audience)];
}

export function readRefreshToken(req: Request, audience: SessionAudience): string | undefined {
  return (req.cookies as Record<string, string | undefined>)[refreshCookie(audience)];
}

export function setSessionCookies(
  res: Response,
  audience: SessionAudience,
  tokens: SessionTokens,
  secure: boolean,
): void {
  res.cookie(accessCookie(audience), tokens.accessToken, {
    ...baseOptions(secure),
    path: '/',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(refreshCookie(audience), tokens.refreshToken, {
    ...baseOptions(secure),
    path: REFRESH_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookies(
  res: Response,
  audience: SessionAudience,
  secure: boolean,
): void {
  res.clearCookie(accessCookie(audience), { ...baseOptions(secure), path: '/' });
  res.clearCookie(refreshCookie(audience), { ...baseOptions(secure), path: REFRESH_PATH });
}
