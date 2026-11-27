import { messages, resolveLocale } from '@gatefit/i18n';
import {
  MEMBER_FILE_MAX_BYTES,
  MEMBERSHIP_IMPORT_FIELDS,
  type MembershipImportDto,
  type MembershipImportRevertInput,
  membershipImportRevertSchema,
  type MembershipImportValidateInput,
  membershipImportValidateSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
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
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import type { AppRequest } from '../../../common/http/app-request';
import { staffCaller } from '../../../common/http/staff-request';
import type { UploadedFileData } from '../../../common/http/uploaded-file';
import { TenantDb } from '../../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../../common/validation/zod';
import { RequirePermission } from '../../auth/auth.decorators';
import { RequireModule } from '../../entitlements/entitlements.service';
import { downloadTo } from '../../members/import/download';
import { OrganizationService } from '../../tenancy/organization.service';
import { MembershipImportsService } from './membership-imports.service';

const fileUpload = FileInterceptor('file', {
  // One byte over the limit is enough for multer to refuse the file (413).
  limits: { fileSize: MEMBER_FILE_MAX_BYTES + 1, files: 1 },
});
const fileBody = {
  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
} as const;

@ApiTags('memberships')
@Controller('membership-imports')
@RequireModule('members')
export class MembershipImportsController {
  constructor(
    private readonly imports: MembershipImportsService,
    private readonly organizations: OrganizationService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('members.import', 'memberships.sell')
  @ApiOperation({ summary: 'Membership imports, newest first' })
  list(
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
    @Req() req: AppRequest,
  ): Promise<Page<MembershipImportDto>> {
    return this.imports.list(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get('template')
  @RequirePermission('members.import', 'memberships.sell')
  @ApiOperation({ summary: 'An empty XLSX file with the columns a membership import understands' })
  async template(@Req() req: AppRequest, @Res() res: Response): Promise<void> {
    const caller = staffCaller(req);
    const organization = await this.organizations.get(this.tenantDb.tx, caller.organizationId);
    const columns = messages[resolveLocale(organization.locale)].membershipFile.columns;
    const out = downloadTo(res).start(
      'memberships-template.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out });
    const sheet = workbook.addWorksheet('Memberships');
    sheet.addRow(MEMBERSHIP_IMPORT_FIELDS.map((field) => columns[field])).commit();
    sheet.commit();
    await workbook.commit();
  }

  @Post()
  @RequirePermission('members.import', 'memberships.sell')
  @UseInterceptors(fileUpload)
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @ApiOperation({
    summary:
      'Upload a CSV or XLSX file of memberships; returns its columns and a suggested mapping',
  })
  upload(
    @UploadedFile() file: UploadedFileData | undefined,
    @Req() req: AppRequest,
  ): Promise<MembershipImportDto> {
    return this.imports.upload(this.tenantDb.tx, staffCaller(req), file);
  }

  @Get(':id')
  @RequirePermission('members.import', 'memberships.sell')
  @ApiOperation({ summary: 'A membership import with its progress and row errors' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<MembershipImportDto> {
    return this.imports.get(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('members.import', 'memberships.sell')
  @ApiOperation({ summary: 'Check every row with the chosen column mapping' })
  @ApiBody(zodBody(membershipImportValidateSchema))
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(membershipImportValidateSchema)) body: MembershipImportValidateInput,
    @Req() req: AppRequest,
  ): Promise<MembershipImportDto> {
    return this.imports.validate(this.tenantDb.tx, staffCaller(req), id, body);
  }

  @Post(':id/commit')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('members.import', 'memberships.sell')
  @ApiOperation({ summary: 'Write the valid rows in the background' })
  commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<MembershipImportDto> {
    return this.imports.commit(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/revert')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('members.import', 'memberships.cancel')
  @ApiOperation({
    summary: 'Cancel the memberships of a finished import, while none has been used or paid for',
  })
  @ApiBody(zodBody(membershipImportRevertSchema))
  revert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(membershipImportRevertSchema)) body: MembershipImportRevertInput,
    @Req() req: AppRequest,
  ): Promise<MembershipImportDto> {
    return this.imports.revert(this.tenantDb.tx, staffCaller(req), id, body);
  }
}
