import { Module } from '@nestjs/common';
import {
  BrandingController,
  LocationsController,
  OrganizationController,
} from './organization.controller';
import { OrganizationService } from './organization.service';

// Owns the organizations and locations tables.
@Module({
  controllers: [OrganizationController, LocationsController, BrandingController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
