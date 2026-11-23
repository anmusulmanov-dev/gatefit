import type { MemberProfileDto } from '@gatefit/shared';
import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { memberUser } from '../../common/http/member-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { AnyAuthenticated } from '../auth/auth.decorators';
import { MembersService } from './members.service';

/** The member app's view of the signed-in member (docs/TZ.md F-9.1). */
@ApiTags('member app')
@Controller('me')
export class MeMemberController {
  constructor(
    private readonly members: MembersService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('member')
  @AnyAuthenticated()
  @ApiOperation({ summary: "The signed-in member's profile (member app only)" })
  profile(@Req() req: AppRequest): Promise<MemberProfileDto> {
    return this.members.ownProfile(this.tenantDb.tx, memberUser(req).userId);
  }
}
