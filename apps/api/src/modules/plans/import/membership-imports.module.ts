import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { BillingModule } from '../../billing/billing.module';
import { MembersModule } from '../../members/members.module';
import { OrganizationModule } from '../../tenancy/organization.module';
import { PlansModule } from '../plans.module';
import { MembershipImportsController } from './membership-imports.controller';
import { MembershipImportsService } from './membership-imports.service';

// Part of the plans area, apart from PlansModule because undoing an import asks the access
// module about entries, and the access module itself depends on PlansModule. Owns the
// membership_imports table; memberships are written through MembershipsService.
@Module({
  imports: [PlansModule, MembersModule, BillingModule, OrganizationModule, AccessModule],
  controllers: [MembershipImportsController],
  providers: [MembershipImportsService],
})
export class MembershipImportsModule {}
