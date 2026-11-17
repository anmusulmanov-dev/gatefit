import {
  type Page,
  type PlatformOrganizationCreateInput,
  platformOrganizationCreateSchema,
  type PlatformOrganizationDetailDto,
  type PlatformOrganizationDto,
  type PlatformOrganizationListQuery,
  platformOrganizationListQuerySchema,
  type PlatformOrganizationUpdateInput,
  platformOrganizationUpdateSchema,
  type SaasPlanCreateInput,
  saasPlanCreateSchema,
  type SaasPlanDto,
  type SaasPlanUpdateInput,
  saasPlanUpdateSchema,
  type StaffPasswordResetInput,
  staffPasswordResetSchema,
} from '@gatefit/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { PlatformOrganizationsService } from './organizations.service';
import { PlansService } from './plans.service';
import { Platform, platformAdminOf, type PlatformRequest } from './platform.http';

@ApiTags('platform')
@Platform()
@Controller('platform/organizations')
export class PlatformOrganizationsController {
  constructor(private readonly organizations: PlatformOrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'List organizations, oldest first' })
  list(
    @Query(new ZodPipe(platformOrganizationListQuerySchema)) query: PlatformOrganizationListQuery,
  ): Promise<Page<PlatformOrganizationDto>> {
    return this.organizations.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One organization with its owners' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformOrganizationDetailDto> {
    return this.organizations.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Open an organization with its first location, roles and owner' })
  @ApiBody(zodBody(platformOrganizationCreateSchema))
  create(
    @Body(new ZodPipe(platformOrganizationCreateSchema)) body: PlatformOrganizationCreateInput,
    @Req() req: PlatformRequest,
  ): Promise<PlatformOrganizationDetailDto> {
    return this.organizations.create(platformAdminOf(req).id, req.ip, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Block or unblock, set the trial end, assign a plan' })
  @ApiBody(zodBody(platformOrganizationUpdateSchema))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(platformOrganizationUpdateSchema)) body: PlatformOrganizationUpdateInput,
    @Req() req: PlatformRequest,
  ): Promise<PlatformOrganizationDetailDto> {
    return this.organizations.update(platformAdminOf(req).id, req.ip, id, body);
  }

  @Post(':id/staff/:staffId/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Give a staff member (typically a locked-out owner) a temporary password',
  })
  @ApiBody(zodBody(staffPasswordResetSchema))
  @ApiNoContentResponse({ description: 'Password replaced' })
  async resetStaffPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body(new ZodPipe(staffPasswordResetSchema)) body: StaffPasswordResetInput,
    @Req() req: PlatformRequest,
  ): Promise<void> {
    await this.organizations.resetStaffPassword(platformAdminOf(req).id, req.ip, id, staffId, body);
  }

  @Post(':id/staff/:staffId/reset-totp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a staff member's authenticator" })
  @ApiNoContentResponse({ description: 'Authenticator removed' })
  async resetStaffTotp(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Req() req: PlatformRequest,
  ): Promise<void> {
    await this.organizations.resetStaffTotp(platformAdminOf(req).id, req.ip, id, staffId);
  }
}

@ApiTags('platform')
@Platform()
@Controller('platform/saas-plans')
export class PlatformPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'List plans, cheapest first' })
  list(): Promise<SaasPlanDto[]> {
    return this.plans.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a plan' })
  @ApiBody(zodBody(saasPlanCreateSchema))
  create(
    @Body(new ZodPipe(saasPlanCreateSchema)) body: SaasPlanCreateInput,
    @Req() req: PlatformRequest,
  ): Promise<SaasPlanDto> {
    return this.plans.create(platformAdminOf(req).id, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a plan: price, limits, modules, availability' })
  @ApiBody(zodBody(saasPlanUpdateSchema))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(saasPlanUpdateSchema)) body: SaasPlanUpdateInput,
    @Req() req: PlatformRequest,
  ): Promise<SaasPlanDto> {
    return this.plans.update(platformAdminOf(req).id, id, body);
  }
}
