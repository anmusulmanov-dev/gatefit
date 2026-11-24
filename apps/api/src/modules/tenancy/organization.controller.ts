import {
  type BrandingDto,
  type LocationCreateInput,
  locationCreateSchema,
  type LocationDto,
  locationListQuerySchema,
  type LocationUpdateInput,
  locationUpdateSchema,
  type OrganizationDto,
  type OrganizationUpdateInput,
  organizationUpdateSchema,
} from '@gatefit/shared';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { Public, RequirePermission } from '../auth/auth.decorators';
import { organizationRequired } from '../auth/auth.errors';
import { OrganizationService } from './organization.service';

@ApiTags('organization')
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly organization: OrganizationService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('organization.read')
  @ApiOperation({ summary: 'The current organization' })
  get(@Req() req: AppRequest): Promise<OrganizationDto> {
    return this.organization.get(this.tenantDb.tx, staffCaller(req).organizationId);
  }

  @Patch()
  @RequirePermission('organization.update')
  @ApiOperation({ summary: 'Change the organization name, default language or theme' })
  @ApiBody(zodBody(organizationUpdateSchema))
  update(
    @Body(new ZodPipe(organizationUpdateSchema)) body: OrganizationUpdateInput,
    @Req() req: AppRequest,
  ): Promise<OrganizationDto> {
    return this.organization.update(this.tenantDb.tx, staffCaller(req), body);
  }
}

@ApiTags('organization')
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly organization: OrganizationService,
    private readonly tenantDb: TenantDb,
  ) {}

  // Not paginated: an organization has a handful of locations and every screen needs them all.
  @Get()
  @RequirePermission('locations.read')
  @ApiOperation({ summary: 'List locations' })
  @ApiQuery({ name: 'includeArchived', required: false, enum: ['true', 'false'] })
  list(
    @Query(new ZodPipe(locationListQuerySchema)) query: { includeArchived: boolean },
  ): Promise<LocationDto[]> {
    return this.organization.listLocations(this.tenantDb.tx, query.includeArchived);
  }

  @Post()
  @RequirePermission('locations.manage')
  @ApiOperation({ summary: 'Add a location' })
  @ApiBody(zodBody(locationCreateSchema))
  create(
    @Body(new ZodPipe(locationCreateSchema)) body: LocationCreateInput,
    @Req() req: AppRequest,
  ): Promise<LocationDto> {
    return this.organization.createLocation(this.tenantDb.tx, staffCaller(req), body);
  }

  @Patch(':id')
  @RequirePermission('locations.manage')
  @ApiOperation({ summary: 'Edit, archive or restore a location' })
  @ApiBody(zodBody(locationUpdateSchema))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(locationUpdateSchema)) body: LocationUpdateInput,
  ): Promise<LocationDto> {
    return this.organization.updateLocation(this.tenantDb.tx, id, body);
  }
}

// Before sign-in, a page knows only its address: this tells it whose it is and how it looks.
@ApiTags('organization')
@Controller('branding')
export class BrandingController {
  constructor(
    private readonly organization: OrganizationService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Name and theme of the organization at this address' })
  get(@Req() req: AppRequest): Promise<BrandingDto> {
    const tenant = req.tenant;
    if (!tenant) {
      throw organizationRequired();
    }
    return this.tenantDb.run(tenant.id, (tx) => this.organization.branding(tx, tenant.id));
  }
}
