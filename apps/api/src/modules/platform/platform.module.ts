import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffModule } from '../staff/staff.module';
import { PlatformOrganizationsService } from './organizations.service';
import { PlansService } from './plans.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformPrismaService } from './platform-prisma.service';
import { PlatformSessionService } from './platform-session.service';
import { PlatformOrganizationsController, PlatformPlansController } from './platform.controller';
import { PlatformAuthGuard, PlatformHostGuard } from './platform.http';

// Gatefit's own back office. The only module that holds the connection which bypasses
// row-level security; PlatformPrismaService is not exported on purpose.
@Module({
  imports: [AuthModule, StaffModule],
  controllers: [PlatformAuthController, PlatformOrganizationsController, PlatformPlansController],
  providers: [
    PlansService,
    PlatformAuthGuard,
    PlatformAuthService,
    PlatformHostGuard,
    PlatformOrganizationsService,
    PlatformPrismaService,
    PlatformSessionService,
  ],
})
export class PlatformModule {}
