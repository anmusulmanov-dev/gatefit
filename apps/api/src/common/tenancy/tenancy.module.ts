import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantDb } from './tenant-db.service';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

@Global()
@Module({
  providers: [TenantDb, { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor }],
  exports: [TenantDb],
})
export class TenancyModule {}
