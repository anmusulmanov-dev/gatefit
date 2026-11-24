import {
  type BrandingDto,
  COLOR_MODE_COOKIE,
  fetchBranding,
  parseColorMode,
} from '@gatefit/shared';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

/** The organization at this address: its name and theme, or null if there is none. */
export const getBranding = cache(async (): Promise<BrandingDto | null> => {
  const requestHeaders = await headers();
  return fetchBranding({
    apiUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:8000',
    audience: 'member',
    host: requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
  });
});

/** Light, dark or the system's: each person's own choice, remembered in a cookie. */
export async function getColorMode() {
  return parseColorMode((await cookies()).get(COLOR_MODE_COOKIE)?.value);
}
