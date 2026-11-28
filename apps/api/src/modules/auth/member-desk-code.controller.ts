import type { MemberDeskCodeDto } from '@gatefit/shared';
import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { RequireModule } from '../entitlements/entitlements.service';
import { RequirePermission } from './auth.decorators';
import { OtpService } from './otp.service';

/**
 * Member app sign-in without SMS: the receptionist gets a one-time code for the member and
 * reads it out. Lives in the auth module, which owns sign-in codes.
 */
@ApiTags('members')
@Controller('members')
@RequireModule('members')
export class MemberDeskCodeController {
  constructor(
    private readonly otp: OtpService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Post(':id/sign-in-code')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('members.manage')
  @ApiOperation({ summary: 'A one-time member app sign-in code to hand out at the front desk' })
  @ApiOkResponse({ description: 'The code and when it expires (15 minutes)' })
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<MemberDeskCodeDto> {
    return this.otp.issueAtDesk(this.tenantDb.tx, staffCaller(req), id);
  }
}
