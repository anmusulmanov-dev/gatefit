import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { BillingModule } from '../billing/billing.module';
import { MembersModule } from '../members/members.module';
import { PlansModule } from '../plans/plans.module';
import { OrganizationModule } from '../tenancy/organization.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// Owns no tables: reports are read through the services of the modules that own the data.
@Module({
  imports: [AccessModule, BillingModule, MembersModule, PlansModule, OrganizationModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
