import { type StaffPasswordResetInput, staffPasswordResetSchema } from '@gatefit/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { RequirePermission } from './auth.decorators';
import { StaffSecurityService } from './staff-security.service';

@ApiTags('staff')
@Controller('staff/:id')
export class StaffSecurityController {
  constructor(
    private readonly security: StaffSecurityService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Post('reset-password')
  @RequirePermission('staff.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Give a staff member a temporary password and sign them out' })
  @ApiBody(zodBody(staffPasswordResetSchema))
  @ApiNoContentResponse({ description: 'Password replaced' })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(staffPasswordResetSchema)) body: StaffPasswordResetInput,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.security.resetPassword(this.tenantDb.tx, staffCaller(req), id, body);
  }

  @Post('reset-totp')
  @RequirePermission('staff.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a staff member's authenticator and sign them out" })
  @ApiNoContentResponse({ description: 'Authenticator removed' })
  async resetTotp(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<void> {
    await this.security.resetTotp(this.tenantDb.tx, staffCaller(req), id);
  }
}
