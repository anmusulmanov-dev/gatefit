import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { AppRequest } from '../http/app-request';
import { TenantDb } from './tenant-db.service';

/**
 * Wraps a tenant request in one TenantDb transaction: every query of the handler sees only
 * its organization, and the whole request commits or rolls back together. Requests with no
 * `organizationId` (health, sign-in) pass through untouched and have no ambient tenant
 * access; AuthGuard sets it after verifying the access token.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(private readonly tenantDb: TenantDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { organizationId } = context.switchToHttp().getRequest<AppRequest>();
    if (!organizationId) {
      return next.handle();
    }

    return from(
      this.tenantDb.run(organizationId, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
