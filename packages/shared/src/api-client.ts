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
export interface ApiClientOptions {
  /** Path prefix of the API, as seen from the browser. */
  prefix?: string;
  /** Renew an expired staff or member session and repeat the request once. */
  refreshOnExpiry?: boolean;
}

export function createApiClient(
  audience: SessionAudience,
  { prefix = API_PREFIX, refreshOnExpiry = true }: ApiClientOptions = {},
) {
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

  async function send<T>(
    method: Method,
    path: string,
    body?: unknown,
    read: Reader = readJson,
  ): Promise<ApiResult<T>> {
    let response: Response;
    try {
      // A FormData body sets its own multipart content type.
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
      response = await fetch(`${prefix}${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          [CLIENT_HEADER]: audience,
          ...(body === undefined || isForm ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, error: unexpected };
    }

    if (response.ok) {
      return { ok: true, data: (await read(response)) as T };
    }

    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    return { ok: false, status: response.status, error: parsed.success ? parsed.data : unexpected };
  }

  async function request<T = void>(
    method: Method,
    path: string,
    body?: unknown,
    read?: Reader,
  ): Promise<ApiResult<T>> {
    const result = await send<T>(method, path, body, read);

    const sessionExpired =
      refreshOnExpiry &&
      !result.ok &&
      result.error.code === ErrorCode.UNAUTHORIZED &&
      !path.startsWith('/auth/');
    if (!sessionExpired) {
      return result;
    }

    return (await refreshSession()) ? send<T>(method, path, body, read) : result;
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T = void>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
    put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
    delete: <T = void>(path: string) => request<T>('DELETE', path),
    /** Sends one file as multipart form data, in the field `file`. */
    upload: <T>(method: 'POST' | 'PUT', path: string, file: Blob, fileName: string) => {
      const form = new FormData();
      form.append('file', file, fileName);
      return request<T>(method, path, form);
    },
    /** Fetches a file the API generates, with the name it suggests. */
    download: (path: string) => request<DownloadedFile>('GET', path, undefined, readFile),
  };
}

export interface DownloadedFile {
  blob: Blob;
  fileName: string | null;
}

type Reader = (response: Response) => Promise<unknown>;

const readJson: Reader = async (response) =>
  response.status === 204 ? undefined : ((await response.json()) as unknown);

const readFile: Reader = async (response): Promise<DownloadedFile> => ({
  blob: await response.blob(),
  fileName:
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? null,
});

export type ApiClient = ReturnType<typeof createApiClient>;
