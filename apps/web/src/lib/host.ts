import { headers } from 'next/headers';

/** The host the browser asked for, as forwarded by a proxy when there is one. */
export async function requestHost(): Promise<string | null> {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
}

/**
 * True for Gatefit's own back office (admin.gatefit.uz, admin.localhost in development).
 * `admin` is a reserved subdomain, so it can never be an organization.
 */
export function isPlatformHost(host: string | null): boolean {
  return host?.toLowerCase().split('.')[0] === 'admin';
}
