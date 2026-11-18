import {
  type Page,
  type RoleCreateInput,
  roleCreateSchema,
  type RoleDto,
  type RoleUpdateInput,
  roleUpdateSchema,
  type StaffCreateInput,
  staffCreateSchema,
  type StaffDto,
  type StaffListQuery,
  staffListQuerySchema,
  type StaffUpdateInput,
  staffUpdateSchema,
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
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { RequirePermission } from '../auth/auth.decorators';
import { RolesService } from './roles.service';
import { StaffService } from './staff.service';

@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('staff.read')
  @ApiOperation({ summary: 'List staff, oldest first' })
  list(@Query(new ZodPipe(staffListQuerySchema)) query: StaffListQuery): Promise<Page<StaffDto>> {
    return this.staff.list(this.tenantDb.tx, query);
  }

  @Post()
  @RequirePermission('staff.manage')
  @ApiOperation({ summary: 'Add a staff member with a temporary password' })
  @ApiBody(zodBody(staffCreateSchema))
  create(
    @Body(new ZodPipe(staffCreateSchema)) body: StaffCreateInput,
    @Req() req: AppRequest,
  ): Promise<StaffDto> {
    return this.staff.create(this.tenantDb.tx, staffCaller(req), body);
  }

  @Patch(':id')
  @RequirePermission('staff.manage')
  @ApiOperation({ summary: 'Edit a staff member, their role, locations or status' })
  @ApiBody(zodBody(staffUpdateSchema))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(staffUpdateSchema)) body: StaffUpdateInput,
    @Req() req: AppRequest,
  ): Promise<StaffDto> {
    return this.staff.update(this.tenantDb.tx, staffCaller(req), id, body);
  }
}

@ApiTags('staff')
@Controller('roles')
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('roles.read')
  @ApiOperation({ summary: 'List roles with their permissions' })
  list(): Promise<RoleDto[]> {
    return this.roles.list(this.tenantDb.tx);
  }

  @Post()
  @RequirePermission('roles.manage')
  @ApiOperation({ summary: 'Create a custom role' })
  @ApiBody(zodBody(roleCreateSchema))
  create(
    @Body(new ZodPipe(roleCreateSchema)) body: RoleCreateInput,
    @Req() req: AppRequest,
  ): Promise<RoleDto> {
    return this.roles.create(this.tenantDb.tx, staffCaller(req), body);
  }

  @Patch(':id')
  @RequirePermission('roles.manage')
  @ApiOperation({ summary: 'Rename a custom role, replace its permissions or archive it' })
  @ApiBody(zodBody(roleUpdateSchema))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(roleUpdateSchema)) body: RoleUpdateInput,
    @Req() req: AppRequest,
  ): Promise<RoleDto> {
    return this.roles.update(this.tenantDb.tx, staffCaller(req), id, body);
  }
}
