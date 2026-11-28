import { MEMBER_HOST_SUFFIX } from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { tenantSlugFromHost } from '../../common/tenancy/tenant-slug';
import type { Env } from '../../config/env';

/**
 * Decides which host names the reverse proxy may obtain TLS certificates for. Caddy issues
 * certificates on demand, on the first request to a new organization's subdomain, and asks
 * this service first so that nobody can make it request certificates for arbitrary names.
 */
@Injectable()
export class TlsService {
  private readonly baseDomain: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.baseDomain = config.get('APP_BASE_DOMAIN', { infer: true }).toLowerCase();
  }

  /**
   * Allowed: the bare domain, `admin.<base>`, and for an existing organization (blocked ones
   * included, so they can see why) `<slug>.<base>` (staff panel) and `<slug>-my.<base>`
   * (member app).
   */
  async isAllowed(domain: string): Promise<boolean> {
    const host = domain.trim().toLowerCase().replace(/\.$/, '');
    const base = this.baseDomain;
    if (host === base || host === `admin.${base}`) {
      return true;
    }

    const slug = tenantSlugFromHost(host, base);
    if (!slug || (host !== `${slug}.${base}` && host !== `${slug}${MEMBER_HOST_SUFFIX}.${base}`)) {
      return false;
    }

    // organizations is hidden by RLS without a tenant; this narrow function is the same
    // lookup the tenant resolution middleware uses.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM auth_resolve_organization(${slug})`;
    return rows.length > 0;
  }
}
