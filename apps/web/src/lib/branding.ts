import {
  type BrandingDto,
  COLOR_MODE_COOKIE,
  fetchBranding,
  parseColorMode,
} from '@gatefit/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { isPlatformHost, requestHost } from '@/lib/host';

/** The organization at this address: its name and theme. Null on the platform panel. */
export const getBranding = cache(async (): Promise<BrandingDto | null> => {
  const host = await requestHost();
  if (isPlatformHost(host)) {
    return null;
  }
  return fetchBranding({
    apiUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:8000',
    audience: 'staff',
    host,
  });
});

/** Light, dark or the system's: each person's own choice, remembered in a cookie. */
export async function getColorMode() {
  return parseColorMode((await cookies()).get(COLOR_MODE_COOKIE)?.value);
}
