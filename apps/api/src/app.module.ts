import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ClockModule } from './common/clock/clock';
import { FiscalModule } from './common/fiscal/fiscal.provider';
import { CryptoModule } from './common/crypto/crypto.service';
import { AuditModule } from './common/audit/audit.service';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { OriginCheckMiddleware } from './common/http/origin-check.middleware';
import { LoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { QueueModule } from './common/queue/queue.service';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RateLimitModule } from './common/rate-limit/rate-limiter.service';
import { RedisModule } from './common/redis/redis.module';
import { SecurityModule } from './common/security/security.module';
import { SmsModule } from './common/sms/sms.provider';
import { FileLinksModule } from './common/storage/file-links.service';
import { FileStorageModule } from './common/storage/file-storage';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { TenantResolutionMiddleware } from './common/tenancy/tenant-resolution.middleware';
import { TenantTransactionInterceptor } from './common/tenancy/tenant-transaction.interceptor';
import { ConfigModule } from './config/config.module';
import { AccessInterceptor } from './modules/auth/access.interceptor';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { AccessModule } from './modules/access/access.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.service';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { MembersModule } from './modules/members/members.module';
import { MembershipImportsModule } from './modules/plans/import/membership-imports.module';
import { PlansModule } from './modules/plans/plans.module';
import { ShopModule } from './modules/shop/shop.module';
import { PlatformModule } from './modules/platform/platform.module';
import { StaffModule } from './modules/staff/staff.module';
import { OrganizationModule } from './modules/tenancy/organization.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ClockModule,
    CryptoModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    RateLimitModule,
    SmsModule,
    FiscalModule,
    FileStorageModule,
    FileLinksModule,
    SecurityModule,
    AuditModule,
    TenancyModule,
    EntitlementsModule,
    AuthModule,
    StaffModule,
    MembersModule,
    PlansModule,
    MembershipImportsModule,
    ShopModule,
    BillingModule,
    AccessModule,
    NotificationsModule,
    ReportsModule,
    PlatformModule,
    OrganizationModule,
    FilesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    // The request pipeline, in order. Each step relies on the ones before it.
    //   middleware   OriginCheck -> TenantResolution (req.tenant)
    //   guards       RateLimit -> Auth (req.auth, req.organizationId)
    //   interceptors TenantTransaction (opens the tenant transaction) -> Access (permissions)
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_INTERCEPTOR, useExisting: TenantTransactionInterceptor },
    { provide: APP_INTERCEPTOR, useExisting: AccessInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginCheckMiddleware, TenantResolutionMiddleware).forRoutes('{*path}');
  }
}
