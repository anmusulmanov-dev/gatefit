import { MEMBER_HOST_SUFFIX, RESERVED_SLUGS, SLUG_PATTERN } from '@gatefit/shared';

/**
 * Extracts the organization slug from a host name: `demo.gatefit.uz` (staff panel) and
 * `demo-my.gatefit.uz` (member app) both yield `demo` when the base domain is `gatefit.uz`.
 * Returns null for the bare domain, deeper names, foreign hosts and reserved names.
 */
export function tenantSlugFromHost(hostname: string, baseDomain: string): string | null {
  const host = hostname.toLowerCase();
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!host.endsWith(suffix)) {
    return null;
  }

  const label = host.slice(0, -suffix.length);
  const slug = label.endsWith(MEMBER_HOST_SUFFIX)
    ? label.slice(0, -MEMBER_HOST_SUFFIX.length)
    : label;
  if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.includes(slug)) {
    return null;
  }
  return slug;
}
