import {
  type AccessEventDto,
  type AccessExitInput,
  accessExitSchema,
  type AccessManualInput,
  accessManualSchema,
  type AccessResultDto,
  type AccessSyncInput,
  accessSyncSchema,
  type AccessSyncResultDto,
  type AccessVerifyInput,
  accessVerifySchema,
  type CheckInDto,
  type CheckInListQuery,
  checkInListQuerySchema,
  ErrorCode,
  type LocationQuery,
  locationQuerySchema,
  type OccupancyDto,
  type OfflineSnapshotDto,
  type Page,
  type QrTokenDto,
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
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { forbidden } from '../../common/errors/domain-errors';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { AnyAuthenticated, RequirePermission } from '../auth/auth.decorators';
import { RequireModule } from '../entitlements/entitlements.service';
import { AccessEventsService } from './access-events.service';
import { AccessService } from './access.service';

/** Keeps proxies from closing a quiet live feed. */
const HEARTBEAT_MS = 25_000;
/** A live feed is closed after this long; the screen reconnects, which checks the session again. */
const FEED_LIFETIME_MS = 60 * 60 * 1000;

@ApiTags('access')
@Controller()
@RequireModule('access')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly events: AccessEventsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('me/qr')
  @AnyAuthenticated()
  @ApiOperation({ summary: "The signed-in member's entry code; a new one every 30 seconds" })
  qr(@Req() req: AppRequest): Promise<QrTokenDto> {
    const { auth, organizationId } = req;
    if (auth?.audience !== 'member' || !organizationId) {
      throw forbidden(ErrorCode.PERMISSION_DENIED, 'Only members have an entry code');
    }
    return this.access.qr(this.tenantDb.tx, organizationId, auth.userId);
  }

  @Post('access/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('access.verify')
  @ApiBody(zodBody(accessVerifySchema))
  @ApiOperation({ summary: 'Check a scanned code at a desk and record the entry' })
  verify(
    @Body(new ZodPipe(accessVerifySchema)) input: AccessVerifyInput,
    @Req() req: AppRequest,
  ): Promise<AccessResultDto> {
    return this.access.verify(this.tenantDb.tx, staffCaller(req), input);
  }

  @Post('access/manual')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('access.manual')
  @ApiBody(zodBody(accessManualSchema))
  @ApiOperation({ summary: 'Let a member in by hand, with a reason (audited)' })
  manual(
    @Body(new ZodPipe(accessManualSchema)) input: AccessManualInput,
    @Req() req: AppRequest,
  ): Promise<AccessResultDto> {
    return this.access.manual(this.tenantDb.tx, staffCaller(req), input);
  }

  @Post('access/exit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('access.manual')
  @ApiBody(zodBody(accessExitSchema))
  @ApiOperation({ summary: 'Mark a member as gone' })
  exit(
    @Body(new ZodPipe(accessExitSchema)) input: AccessExitInput,
    @Req() req: AppRequest,
  ): Promise<CheckInDto> {
    return this.access.exit(this.tenantDb.tx, staffCaller(req), input);
  }

  @Get('check-ins')
  @RequirePermission('access.read')
  @ApiOperation({ summary: 'The entry journal, newest first' })
  list(
    @Query(new ZodPipe(checkInListQuerySchema)) query: CheckInListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<CheckInDto>> {
    return this.access.list(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get('locations/:id/occupancy')
  @RequirePermission('access.read')
  @ApiOperation({ summary: 'How many people are inside now' })
  occupancy(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<OccupancyDto> {
    return this.access.occupancy(this.tenantDb.tx, staffCaller(req), id);
  }

  @Get('access/offline')
  @RequirePermission('access.verify')
  @ApiOperation({ summary: 'What a reception screen keeps to check codes while offline' })
  offline(
    @Query(new ZodPipe(locationQuerySchema)) query: LocationQuery,
    @Req() req: AppRequest,
  ): Promise<OfflineSnapshotDto> {
    return this.access.snapshot(this.tenantDb.tx, staffCaller(req), query.locationId);
  }

  @Post('access/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('access.verify')
  @ApiBody(zodBody(accessSyncSchema))
  @ApiOperation({ summary: 'Entries a reception screen decided while offline' })
  sync(
    @Body(new ZodPipe(accessSyncSchema)) input: AccessSyncInput,
    @Req() req: AppRequest,
  ): Promise<AccessSyncResultDto> {
    return this.access.sync(this.tenantDb.tx, staffCaller(req), input);
  }

  /**
   * Server-sent events with each entry at the location and the new head count. The
   * request's transaction ends once the feed is set up; the feed itself reads nothing.
   */
  @Get('access/events')
  @RequirePermission('access.read')
  @ApiOperation({ summary: "Live feed of a location's entries (text/event-stream)" })
  async feed(
    @Query(new ZodPipe(locationQuerySchema)) query: LocationQuery,
    @Req() req: AppRequest,
    @Res() res: Response,
  ): Promise<void> {
    const caller = staffCaller(req);
    // Also checks that the caller works at the location.
    const occupancy = await this.access.occupancy(this.tenantDb.tx, caller, query.locationId);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (name: string, data: unknown) => {
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('occupancy', occupancy);
    const unsubscribe = this.events.subscribe(
      caller.organizationId,
      query.locationId,
      (event: AccessEventDto) => {
        send('check-in', event);
      },
    );
    const heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, HEARTBEAT_MS);
    const lifetime = setTimeout(() => {
      res.end();
    }, FEED_LIFETIME_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      unsubscribe();
    });
  }
}
