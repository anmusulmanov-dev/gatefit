import {
  type MemberBlockInput,
  memberBlockSchema,
  type MemberCreateInput,
  memberCreateSchema,
  type MemberDto,
  type MemberDuplicatesDto,
  type MemberDuplicatesQuery,
  memberDuplicatesQuerySchema,
  type MemberListQuery,
  memberListQuerySchema,
  type MemberUpdateInput,
  memberUpdateSchema,
  type Page,
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
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { RequirePermission } from '../auth/auth.decorators';
import { RequireModule } from '../entitlements/entitlements.service';
import { MembersService } from './members.service';

@ApiTags('members')
@Controller('members')
@RequireModule('members')
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('members.read')
  @ApiOperation({ summary: 'List members, newest first; search by name or phone' })
  list(
    @Query(new ZodPipe(memberListQuerySchema)) query: MemberListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<MemberDto>> {
    return this.members.list(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get('duplicates')
  @RequirePermission('members.read')
  @ApiOperation({ summary: 'Members that one being entered may duplicate' })
  duplicates(
    @Query(new ZodPipe(memberDuplicatesQuerySchema)) query: MemberDuplicatesQuery,
    @Req() req: AppRequest,
  ): Promise<MemberDuplicatesDto> {
    return this.members.duplicates(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get(':id')
  @RequirePermission('members.read')
  @ApiOperation({ summary: 'One member, archived ones included' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MemberDto> {
    return this.members.get(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post()
  @RequirePermission('members.manage')
  @ApiOperation({ summary: 'Add a member' })
  @ApiBody(zodBody(memberCreateSchema))
  create(
    @Body(new ZodPipe(memberCreateSchema)) body: MemberCreateInput,
    @Req() req: AppRequest,
  ): Promise<MemberDto> {
    return this.members.create(this.tenantDb.tx, staffCaller(req), body);
  }

  @Patch(':id')
  @RequirePermission('members.manage')
  @ApiOperation({ summary: "Edit a member's profile" })
  @ApiBody(zodBody(memberUpdateSchema))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(memberUpdateSchema)) body: MemberUpdateInput,
    @Req() req: AppRequest,
  ): Promise<MemberDto> {
    return this.members.update(this.tenantDb.tx, staffCaller(req), id, body);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('members.manage')
  @ApiOperation({ summary: 'Bar a member from entering, with a reason' })
  @ApiBody(zodBody(memberBlockSchema))
  block(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(memberBlockSchema)) body: MemberBlockInput,
    @Req() req: AppRequest,
  ): Promise<MemberDto> {
    return this.members.block(this.tenantDb.tx, staffCaller(req), id, body);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('members.manage')
  @ApiOperation({ summary: 'Lift a block' })
  unblock(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MemberDto> {
    return this.members.unblock(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('members.archive')
  @ApiOperation({ summary: 'Archive a member (soft delete)' })
  archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MemberDto> {
    return this.members.archive(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('members.archive')
  @ApiOperation({ summary: 'Bring back an archived member' })
  restore(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MemberDto> {
    return this.members.restore(this.tenantDb.tx, staffCaller(req), id);
  }
}
