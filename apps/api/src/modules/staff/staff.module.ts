import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { StaffAccessService } from './staff-access.service';
import { StaffCredentialsService } from './staff-credentials.service';
import { RolesController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

// Owns the staff, staff_locations, roles and role_permissions tables. Other modules reach
// them only through the services exported here (CLAUDE.md rule 7).
@Module({
  controllers: [StaffController, RolesController],
  providers: [RolesService, StaffAccessService, StaffCredentialsService, StaffService],
  exports: [StaffAccessService, StaffCredentialsService, StaffService],
})
export class StaffModule {}
