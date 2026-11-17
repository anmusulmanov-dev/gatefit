import type { PlatformMeResponse } from '@gatefit/shared';
import { headers } from 'next/headers';
import { cache } from 'react';

export type PlatformSession =
  | { kind: 'authenticated'; me: PlatformMeResponse }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable' };

/** The signed-in platform operator, asked from the API once per request. */
export const getPlatformSession = cache(async (): Promise<PlatformSession> => {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const cookie = requestHeaders.get('cookie');

  let response: Response;
  try {
    response = await fetch(
      `${process.env.API_INTERNAL_URL ?? 'http://localhost:8000'}/api/v1/platform/me`,
      {
        cache: 'no-store',
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(host ? { 'x-forwarded-host': host } : {}),
        },
      },
    );
  } catch {
    return { kind: 'unavailable' };
  }

  if (response.ok) {
    return { kind: 'authenticated', me: (await response.json()) as PlatformMeResponse };
  }
  return response.status === 401 ? { kind: 'unauthenticated' } : { kind: 'unavailable' };
});
