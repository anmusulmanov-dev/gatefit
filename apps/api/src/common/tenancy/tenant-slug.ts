// A DNS label: letters, digits and inner hyphens, at most 63 characters.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Subdomains that belong to the platform itself and can never be an organization. */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'app',
  'mail',
  'my',
  'static',
  'status',
  'www',
];

/**
 * Extracts the organization slug from a host name: `demo.gatefit.uz` -> `demo` when the
 * base domain is `gatefit.uz`. The slug is the first label, so `demo.my.gatefit.uz` also
 * yields `demo`. Returns null for the bare domain, foreign hosts and reserved names.
 */
export function tenantSlugFromHost(hostname: string, baseDomain: string): string | null {
  const host = hostname.toLowerCase();
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!host.endsWith(suffix)) {
    return null;
  }

  const slug = host.slice(0, -suffix.length).split('.')[0] ?? '';
  if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.includes(slug)) {
    return null;
  }
  return slug;
}
