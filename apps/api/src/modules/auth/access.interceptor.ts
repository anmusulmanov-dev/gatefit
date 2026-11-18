import type { Permission } from '@gatefit/shared';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, type Observable, switchMap } from 'rxjs';
import type { AppRequest } from '../../common/http/app-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { AccessService } from './access.service';
import { ANY_AUTHENTICATED_KEY, PERMISSIONS_KEY, PUBLIC_KEY } from './auth.decorators';
import { permissionDenied, unauthorized } from './auth.errors';

/**
 * Authorizes every endpoint that is not @Public (CLAUDE.md rule 4). It is an interceptor
 * rather than a guard because it must run inside the request's tenant transaction, which
 * TenantTransactionInterceptor opens just before it: the check costs one query, not a
 * second transaction.
 */
@Injectable()
export class AccessInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets)) {
      return next.handle();
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    const anyAuthenticated = this.reflector.getAllAndOverride<boolean | undefined>(
      ANY_AUTHENTICATED_KEY,
      targets,
    );

    const req = context.switchToHttp().getRequest<AppRequest>();
    return from(this.authorize(req, required, anyAuthenticated === true)).pipe(
      switchMap(() => next.handle()),
    );
  }

  private async authorize(
    req: AppRequest,
    required: Permission[] | undefined,
    anyAuthenticated: boolean,
  ): Promise<void> {
    if (!req.auth) {
      throw unauthorized();
    }

    const access = await this.access.load(this.tenantDb.tx, req.auth);
    if (!access) {
      throw unauthorized();
    }
    req.access = access;

    if (required) {
      const granted = access.staff?.permissions;
      if (!granted || !required.every((permission) => granted.has(permission))) {
        throw permissionDenied();
      }
      return;
    }

    // An endpoint that declares nothing is a mistake: refuse rather than expose it.
    if (!anyAuthenticated) {
      throw permissionDenied();
    }
  }
}
