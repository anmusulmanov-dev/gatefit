import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { MEMBERSHIP_FACTS } from '../members/member-status';
import { MembersModule } from '../members/members.module';
import { OrganizationModule } from '../tenancy/organization.module';
import { MembershipStatusJob } from './membership-status.job';
import { MembershipsController, MemberMembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

// Owns the plans, memberships and membership_freezes tables (docs/TZ.md 5.2). Other
// modules reach them only through the services exported here (CLAUDE.md rule 7).
@Module({
  imports: [MembersModule, OrganizationModule, BillingModule],
  controllers: [PlansController, MemberMembershipsController, MembershipsController],
  providers: [
    PlansService,
    MembershipsService,
    MembershipStatusJob,
    // What the members module asks about memberships (member status, list summaries).
    { provide: MEMBERSHIP_FACTS, useExisting: MembershipsService },
  ],
  exports: [PlansService, MembershipsService, MEMBERSHIP_FACTS],
})
export class PlansModule {}
