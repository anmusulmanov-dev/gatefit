import { fetchSession, type SessionState } from '@gatefit/shared';
import { headers } from 'next/headers';
import { cache } from 'react';

/**
 * Who is signed in, asked from the API once per request. Server components only: this is
 * what decides whether a page renders, so it never relies on anything the browser claims.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  const requestHeaders = await headers();
  return fetchSession({
    apiUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:8000',
    audience: 'member',
    cookie: requestHeaders.get('cookie'),
    host: requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
  });
});
