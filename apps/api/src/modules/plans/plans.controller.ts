import {
  type Page,
  type PlanCreateInput,
  planCreateSchema,
  type PlanDto,
  type PlanListQuery,
  planListQuerySchema,
  type PlanUpdateInput,
  planUpdateSchema,
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
import { RequireModule } from '../entitlements/entitlements.service';
import { PlansService } from './plans.service';

@ApiTags('plans')
@Controller('plans')
@RequireModule('memberships')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('plans.read')
  @ApiOperation({ summary: 'List plans; ?active=true for those on sale' })
  list(@Query(new ZodPipe(planListQuerySchema)) query: PlanListQuery): Promise<Page<PlanDto>> {
    return this.plans.list(this.tenantDb.tx, query);
  }

  @Get(':id')
  @RequirePermission('plans.read')
  @ApiOperation({ summary: 'One plan' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PlanDto> {
    return this.plans.get(this.tenantDb.tx, id);
  }

  @Post()
  @RequirePermission('plans.manage')
  @ApiOperation({ summary: "Add a plan, priced in the organization's currency" })
  @ApiBody(zodBody(planCreateSchema))
  create(
    @Body(new ZodPipe(planCreateSchema)) body: PlanCreateInput,
    @Req() req: AppRequest,
  ): Promise<PlanDto> {
    return this.plans.create(this.tenantDb.tx, staffCaller(req), body);
  }

  @Patch(':id')
  @RequirePermission('plans.manage')
  @ApiOperation({
    summary: 'Edit a plan or withdraw it (isActive); sold memberships keep their terms',
  })
  @ApiBody(zodBody(planUpdateSchema))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(planUpdateSchema)) body: PlanUpdateInput,
    @Req() req: AppRequest,
  ): Promise<PlanDto> {
    return this.plans.update(this.tenantDb.tx, staffCaller(req), id, body);
  }
}
