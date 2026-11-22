import {
  type MembershipCancelInput,
  membershipCancelSchema,
  type MembershipDto,
  type MembershipFreezeInput,
  membershipFreezeSchema,
  type MembershipSellInput,
  membershipSellSchema,
  type Page,
  type SaleDto,
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
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { RequirePermission } from '../auth/auth.decorators';
import { RequireModule } from '../entitlements/entitlements.service';
import { MembershipsService } from './memberships.service';

@ApiTags('memberships')
@Controller('members/:memberId/memberships')
@RequireModule('memberships')
export class MemberMembershipsController {
  constructor(
    private readonly memberships: MembershipsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('members.read')
  @ApiOperation({ summary: "A member's memberships, newest first" })
  list(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
    @Req() req: AppRequest,
  ): Promise<Page<MembershipDto>> {
    return this.memberships.listForMember(this.tenantDb.tx, staffCaller(req), memberId, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('memberships.sell')
  @ApiOperation({ summary: 'Sell a plan to the member, with its invoice and any payment taken' })
  @ApiBody(zodBody(membershipSellSchema))
  sell(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(new ZodPipe(membershipSellSchema)) body: MembershipSellInput,
    @Req() req: AppRequest,
  ): Promise<SaleDto> {
    return this.memberships.sell(this.tenantDb.tx, staffCaller(req), memberId, body);
  }
}

@ApiTags('memberships')
@Controller('memberships')
@RequireModule('memberships')
export class MembershipsController {
  constructor(
    private readonly memberships: MembershipsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get(':id')
  @RequirePermission('members.read')
  @ApiOperation({ summary: 'One membership with its freezes' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MembershipDto> {
    return this.memberships.get(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/freeze')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('memberships.freeze')
  @ApiOperation({ summary: 'Freeze from a day for a number of days; the end moves later' })
  @ApiBody(zodBody(membershipFreezeSchema))
  freeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(membershipFreezeSchema)) body: MembershipFreezeInput,
    @Req() req: AppRequest,
  ): Promise<MembershipDto> {
    return this.memberships.freeze(this.tenantDb.tx, staffCaller(req), id, body);
  }

  @Post(':id/unfreeze')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('memberships.freeze')
  @ApiOperation({ summary: 'End the current freeze early, or drop the next planned one' })
  unfreeze(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<MembershipDto> {
    return this.memberships.unfreeze(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('memberships.cancel')
  @ApiOperation({ summary: 'Cancel a membership, with a reason' })
  @ApiBody(zodBody(membershipCancelSchema))
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(membershipCancelSchema)) body: MembershipCancelInput,
    @Req() req: AppRequest,
  ): Promise<MembershipDto> {
    return this.memberships.cancel(this.tenantDb.tx, staffCaller(req), id, body);
  }
}
