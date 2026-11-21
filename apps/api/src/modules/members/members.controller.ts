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
  type MemberExportQuery,
  memberExportQuerySchema,
  MEMBER_PHOTO_MAX_BYTES,
  memberUpdateSchema,
  type Page,
} from '@gatefit/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AppRequest } from '../../common/http/app-request';
import type { UploadedFileData } from '../../common/http/uploaded-file';
import { staffCaller } from '../../common/http/staff-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { RequirePermission } from '../auth/auth.decorators';
import { RequireModule } from '../entitlements/entitlements.service';
import { downloadTo } from './import/download';
import { MemberExportService } from './import/member-export.service';
import { MembersService } from './members.service';

@ApiTags('members')
@Controller('members')
@RequireModule('members')
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly exports: MemberExportService,
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

  @Get('export')
  @RequirePermission('members.export')
  @ApiOperation({ summary: 'Download members as XLSX or CSV, with the list filters' })
  async export(
    @Query(new ZodPipe(memberExportQuerySchema)) query: MemberExportQuery,
    @Req() req: AppRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.exports.export(this.tenantDb.tx, staffCaller(req), query, downloadTo(res));
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

  @Put(':id/photo')
  @RequirePermission('members.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MEMBER_PHOTO_MAX_BYTES + 1, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: "Replace the member's photo (JPEG, PNG or WebP)" })
  setPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileData | undefined,
    @Req() req: AppRequest,
  ): Promise<MemberDto> {
    return this.members.setPhoto(this.tenantDb.tx, staffCaller(req), id, file);
  }

  @Delete(':id/photo')
  @RequirePermission('members.manage')
  @ApiOperation({ summary: "Remove the member's photo" })
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MemberDto> {
    return this.members.removePhoto(this.tenantDb.tx, staffCaller(req), id);
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
