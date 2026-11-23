import {
  type DailyReportDto,
  type DailyReportQuery,
  dailyReportQuerySchema,
} from '@gatefit/shared';
import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe } from '../../common/validation/zod';
import { RequirePermission } from '../auth/auth.decorators';
import { RequireModule } from '../entitlements/entitlements.service';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
@RequireModule('reports_daily')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('daily')
  @RequirePermission('reports.daily')
  @ApiOperation({
    summary: "A location's day: takings, new members, visits, memberships ending soon",
  })
  daily(
    @Query(new ZodPipe(dailyReportQuerySchema)) query: DailyReportQuery,
    @Req() req: AppRequest,
  ): Promise<DailyReportDto> {
    return this.reports.daily(this.tenantDb.tx, staffCaller(req), query);
  }
}
