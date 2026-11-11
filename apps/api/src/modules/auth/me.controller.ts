import type { MeResponse } from '@gatefit/shared';
import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { AnyAuthenticated } from './auth.decorators';
import { unauthorized } from './auth.errors';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get()
  @AnyAuthenticated()
  @ApiOperation({ summary: 'The signed-in user, their organization, role and permissions' })
  @ApiOkResponse({ description: 'Current user' })
  async me(@Req() req: AppRequest): Promise<MeResponse> {
    const { auth, access } = req;
    if (!auth || !access) {
      throw unauthorized();
    }

    const tx = this.tenantDb.tx;
    const [user, organization] = await Promise.all([
      // Only non-secret columns are readable by the API role.
      tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, phone: true } }),
      tx.organization.findUniqueOrThrow({
        where: { id: req.organizationId },
        select: { id: true, name: true, slug: true, locale: true, currency: true },
      }),
    ]);

    return {
      audience: auth.audience,
      user,
      organization,
      staff: access.staff && {
        ...access.staff,
        permissions: [...access.staff.permissions].sort(),
      },
    };
  }
}
