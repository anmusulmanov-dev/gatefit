import { CLIENT_HEADER, type SessionAudience } from './auth';
import { type ApiError, apiErrorSchema, ErrorCode } from './errors';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const API_PREFIX = '/api/v1';

// Shown when the API cannot be reached or answers with something that is not our error shape.
const unexpected: ApiError = {
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Unexpected error',
  details: null,
};

/**
 * Browser client for the API. Requests go to the app's own origin (a proxy forwards them),
 * so the httpOnly session cookies travel with them and no CORS is involved.
 *
 * When the access token has expired the client refreshes the session once and repeats the
 * request, so callers only ever see a 401 when the user really has to sign in again.
 */
export function createApiClient(audience: SessionAudience) {
  // Shared by concurrent requests: a refresh token works once, so only one refresh may run.
  let refreshing: Promise<boolean> | null = null;

  function refreshSession(): Promise<boolean> {
    refreshing ??= send('POST', '/auth/refresh')
      .then((result) => result.ok)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function send<T>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await fetch(`${API_PREFIX}${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          [CLIENT_HEADER]: audience,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, error: unexpected };
    }

    if (response.ok) {
      const data = response.status === 204 ? undefined : ((await response.json()) as unknown);
      return { ok: true, data: data as T };
    }

    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    return { ok: false, status: response.status, error: parsed.success ? parsed.data : unexpected };
  }

  async function request<T = void>(
    method: Method,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const result = await send<T>(method, path, body);

    const sessionExpired =
      !result.ok && result.error.code === ErrorCode.UNAUTHORIZED && !path.startsWith('/auth/');
    if (!sessionExpired) {
      return result;
    }

    return (await refreshSession()) ? send<T>(method, path, body) : result;
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T = void>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
