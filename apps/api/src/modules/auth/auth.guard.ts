import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../../common/http/app-request';
import { clientAudience, readAccessToken } from './auth.cookies';
import { PLATFORM_KEY, PUBLIC_KEY } from './auth.decorators';
import { organizationRequired, unauthorized } from './auth.errors';
import { TokenService } from './token.service';

/**
 * Authenticates every endpoint that is not @Public. The access token must be valid and
 * issued for the organization whose subdomain is being called (docs/TZ.md section 5.1):
 * a token from one organization is worthless on another's address.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPlatform = this.reflector.getAllAndOverride<boolean | undefined>(PLATFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || isPlatform) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AppRequest>();
    const audience = clientAudience(req);
    const claims = this.tokens.verifyAccess(readAccessToken(req, audience), audience);

    // Protected endpoints exist only at an organization's address.
    if (!req.tenant) {
      throw organizationRequired();
    }
    if (claims?.organizationId !== req.tenant.id) {
      throw unauthorized();
    }

    req.auth = { userId: claims.userId, sessionId: claims.sessionId, audience: claims.audience };
    // From here on TenantTransactionInterceptor scopes the request to this organization.
    req.organizationId = req.tenant.id;
    return true;
  }
}
