import { ErrorCode } from '@gatefit/shared';
import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Response } from 'express';
import type { Env } from '../../config/env';
import { AppException } from '../errors/app.exception';
import type { AppRequest } from '../http/app-request';
import { PrismaService } from '../prisma/prisma.service';
import { tenantSlugFromHost } from './tenant-slug';

interface OrganizationRow {
  id: string;
  status: 'trial' | 'active' | 'blocked';
  locale: string;
}

/**
 * Finds the organization a request addresses from its subdomain and attaches it as
 * `req.tenant`. Runs before authentication: the token is later required to belong to this
 * same organization. Requests to the bare domain (health checks) carry no tenant.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  private readonly baseDomain: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.baseDomain = config.get('APP_BASE_DOMAIN', { infer: true });
  }

  async use(req: AppRequest, _res: Response, next: NextFunction): Promise<void> {
    // req.hostname honours X-Forwarded-Host only when TRUST_PROXY is on.
    const slug = tenantSlugFromHost(req.hostname, this.baseDomain);
    if (!slug) {
      next();
      return;
    }

    // organizations is hidden by RLS until a tenant is set, so the lookup goes through
    // a narrow SECURITY DEFINER function.
    const [organization] = await this.prisma.$queryRaw<OrganizationRow[]>`
      SELECT id, status, locale FROM auth_resolve_organization(${slug})`;

    if (!organization) {
      throw new AppException(
        ErrorCode.ORGANIZATION_NOT_FOUND,
        'Organization not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (organization.status === 'blocked') {
      throw new AppException(
        ErrorCode.ORGANIZATION_BLOCKED,
        'Organization is blocked',
        HttpStatus.FORBIDDEN,
      );
    }

    req.tenant = { id: organization.id, slug, locale: organization.locale };
    next();
  }
}
