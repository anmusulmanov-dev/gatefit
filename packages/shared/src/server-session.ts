import { CLIENT_HEADER, type MeResponse, type SessionAudience } from './auth';
import { type ApiError, ErrorCode } from './errors';

export type SessionState =
  | { kind: 'authenticated'; me: MeResponse }
  /** No valid access token. The refresh token may still be good: try to refresh. */
  | { kind: 'unauthenticated' }
  /** The address is not an organization's (bare domain or unknown subdomain). */
  | { kind: 'no-organization' }
  | { kind: 'organization-blocked' }
  /** The API did not answer. */
  | { kind: 'unavailable' };

export interface SessionRequest {
  /** Where the web server reaches the API, e.g. http://localhost:8000 */
  apiUrl: string;
  audience: SessionAudience;
  /** The browser's Cookie and Host headers, passed through unchanged. */
  cookie: string | null;
  host: string | null;
}

/**
 * Asks the API who the browser is, from a web server (Next.js server component). The
 * browser's host is forwarded so the API resolves the same organization the user sees
 * in the address bar.
 */
export async function fetchSession(request: SessionRequest): Promise<SessionState> {
  let response: Response;
  try {
    response = await fetch(`${request.apiUrl}/api/v1/me`, {
      cache: 'no-store',
      headers: {
        [CLIENT_HEADER]: request.audience,
        ...(request.cookie ? { cookie: request.cookie } : {}),
        ...(request.host ? { 'x-forwarded-host': request.host } : {}),
      },
    });
  } catch {
    return { kind: 'unavailable' };
  }

  if (response.ok) {
    return { kind: 'authenticated', me: (await response.json()) as MeResponse };
  }

  const error = (await response.json().catch(() => null)) as Partial<ApiError> | null;
  switch (error?.code) {
    case ErrorCode.UNAUTHORIZED:
      return { kind: 'unauthenticated' };
    case ErrorCode.ORGANIZATION_NOT_FOUND:
      return { kind: 'no-organization' };
    case ErrorCode.ORGANIZATION_BLOCKED:
      return { kind: 'organization-blocked' };
    default:
      return { kind: 'unavailable' };
  }
}
