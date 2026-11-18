import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { TenantDb } from './tenant-db.service';

/** Set on the request once the organization is established (by authentication, stage 0.3). */
export interface TenantRequest extends Request {
  organizationId?: string;
}

/**
 * Wraps a tenant request in one TenantDb transaction: every query of the handler sees only
 * its organization, and the whole request commits or rolls back together. Requests with no
 * organization (health, login) pass through untouched and have no tenant access at all.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(private readonly tenantDb: TenantDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { organizationId } = context.switchToHttp().getRequest<TenantRequest>();
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
