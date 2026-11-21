import {
  MEMBER_FILE_MAX_BYTES,
  type MemberImportDto,
  type MemberImportValidateInput,
  memberImportValidateSchema,
} from '@gatefit/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AppRequest } from '../../../common/http/app-request';
import type { UploadedFileData } from '../../../common/http/uploaded-file';
import { staffCaller } from '../../../common/http/staff-request';
import { TenantDb } from '../../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../../common/validation/zod';
import { RequirePermission } from '../../auth/auth.decorators';
import { RequireModule } from '../../entitlements/entitlements.service';
import { downloadTo } from './download';
import { MemberExportService } from './member-export.service';
import { MemberImportsService } from './member-imports.service';

const fileUpload = FileInterceptor('file', {
  // One byte over the limit is enough for multer to refuse the file (413).
  limits: { fileSize: MEMBER_FILE_MAX_BYTES + 1, files: 1 },
});
const fileBody = {
  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
} as const;

@ApiTags('members')
@Controller('members/imports')
@RequireModule('members')
export class MemberImportsController {
  constructor(
    private readonly imports: MemberImportsService,
    private readonly exports: MemberExportService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('template')
  @RequirePermission('members.import')
  @ApiOperation({ summary: 'An empty XLSX file with the columns an import understands' })
  async template(@Req() req: AppRequest, @Res() res: Response): Promise<void> {
    await this.exports.template(this.tenantDb.tx, staffCaller(req), downloadTo(res));
  }

  @Post()
  @RequirePermission('members.import')
  @UseInterceptors(fileUpload)
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @ApiOperation({
    summary: 'Upload a CSV or XLSX file; returns its columns and a suggested mapping',
  })
  upload(
    @UploadedFile() file: UploadedFileData | undefined,
    @Req() req: AppRequest,
  ): Promise<MemberImportDto> {
    return this.imports.upload(this.tenantDb.tx, staffCaller(req), file);
  }

  @Get(':id')
  @RequirePermission('members.import')
  @ApiOperation({ summary: 'An import with its progress and row errors' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MemberImportDto> {
    return this.imports.get(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('members.import')
  @ApiOperation({ summary: 'Check every row with the chosen column mapping and location' })
  @ApiBody(zodBody(memberImportValidateSchema))
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(memberImportValidateSchema)) body: MemberImportValidateInput,
    @Req() req: AppRequest,
  ): Promise<MemberImportDto> {
    return this.imports.validate(this.tenantDb.tx, staffCaller(req), id, body);
  }

  @Post(':id/commit')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('members.import')
  @ApiOperation({ summary: 'Import the valid rows in the background' })
  commit(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MemberImportDto> {
    return this.imports.commit(this.tenantDb.tx, staffCaller(req), id);
  }
}
