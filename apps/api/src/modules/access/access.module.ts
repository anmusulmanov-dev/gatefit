import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { PlansModule } from '../plans/plans.module';
import { OrganizationModule } from '../tenancy/organization.module';
import { AccessEventsService } from './access-events.service';
import { AccessTokensService } from './access-tokens.service';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { CheckInPartitionsJob } from './check-in-partitions.job';

// Owns the check_ins table (docs/TZ.md 5.2). Members and memberships are reached through
// the services their modules export (CLAUDE.md rule 7).
@Module({
  imports: [MembersModule, PlansModule, OrganizationModule],
  controllers: [AccessController],
  providers: [AccessService, AccessTokensService, AccessEventsService, CheckInPartitionsJob],
  exports: [AccessService],
})
export class AccessModule {}
