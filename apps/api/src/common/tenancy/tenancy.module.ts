import { Global, Module } from '@nestjs/common';
import { TenantDb } from './tenant-db.service';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

// The interceptor is registered globally by AppModule, where its order relative to the
// access check is explicit.
@Global()
@Module({
  providers: [TenantDb, TenantTransactionInterceptor],
  exports: [TenantDb, TenantTransactionInterceptor],
})
export class TenancyModule {}
