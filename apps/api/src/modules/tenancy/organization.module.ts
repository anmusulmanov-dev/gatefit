import { Module } from '@nestjs/common';
import { LocationsController, OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

// Owns the organizations and locations tables.
@Module({
  controllers: [OrganizationController, LocationsController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
