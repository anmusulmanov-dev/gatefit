import {
  type CashShiftCloseInput,
  cashShiftCloseSchema,
  type CashShiftDto,
  type CashShiftListQuery,
  cashShiftListQuerySchema,
  type CashShiftOpenInput,
  cashShiftOpenSchema,
  type CashShiftQuery,
  cashShiftQuerySchema,
  type InvoiceCreateInput,
  invoiceCreateSchema,
  type InvoiceDto,
  type InvoiceListQuery,
  invoiceListQuerySchema,
  type InvoicePayInput,
  invoicePaySchema,
  type InvoiceVoidInput,
  invoiceVoidSchema,
  type MemberPaymentsDto,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type PaymentDto,
  type PaymentListQuery,
  paymentListQuerySchema,
  type ReceiptDto,
  type RefundCreateInput,
  refundCreateSchema,
  type RefundDto,
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
import { memberUser } from '../../common/http/member-request';
import { staffCaller } from '../../common/http/staff-request';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { AnyAuthenticated, RequirePermission } from '../auth/auth.decorators';
import { RequireModule } from '../entitlements/entitlements.service';
import { CashShiftsService } from './cash-shifts.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('invoices')
@RequireModule('payments')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('payments.read')
  @ApiOperation({ summary: 'Invoices, newest first; filter by member or status' })
  list(
    @Query(new ZodPipe(invoiceListQuerySchema)) query: InvoiceListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<InvoiceDto>> {
    return this.invoices.list(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get(':id')
  @RequirePermission('payments.read')
  @ApiOperation({ summary: 'One invoice with its lines' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<InvoiceDto> {
    return this.invoices.get(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('payments.accept')
  @ApiOperation({ summary: 'Bill a member for other items' })
  @ApiBody(zodBody(invoiceCreateSchema))
  create(
    @Body(new ZodPipe(invoiceCreateSchema)) body: InvoiceCreateInput,
    @Req() req: AppRequest,
  ): Promise<InvoiceDto> {
    return this.invoices.create(this.tenantDb.tx, staffCaller(req), body);
  }

  @Post(':id/payments')
  @Idempotent()
  @RequirePermission('payments.accept')
  @ApiOperation({ summary: 'Take a payment, in full or in part' })
  @ApiBody(zodBody(invoicePaySchema))
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(invoicePaySchema)) body: InvoicePayInput,
    @Req() req: AppRequest,
  ): Promise<InvoiceDto> {
    return this.invoices.pay(this.tenantDb.tx, staffCaller(req), id, body);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payments.refund')
  @ApiOperation({ summary: 'Write off what is still owed, with a reason' })
  @ApiBody(zodBody(invoiceVoidSchema))
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(invoiceVoidSchema)) body: InvoiceVoidInput,
    @Req() req: AppRequest,
  ): Promise<InvoiceDto> {
    return this.invoices.void(this.tenantDb.tx, staffCaller(req), id, body);
  }
}

@ApiTags('payments')
@Controller('payments')
@RequireModule('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('payments.read')
  @ApiOperation({ summary: 'Payments journal, newest first' })
  list(
    @Query(new ZodPipe(paymentListQuerySchema)) query: PaymentListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<PaymentDto>> {
    return this.payments.list(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get(':id')
  @RequirePermission('payments.read')
  @ApiOperation({ summary: 'One payment' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<PaymentDto> {
    return this.payments.get(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/refund')
  @Idempotent()
  @RequirePermission('payments.refund')
  @ApiOperation({ summary: 'Give money back, with a reason' })
  @ApiBody(zodBody(refundCreateSchema))
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(refundCreateSchema)) body: RefundCreateInput,
    @Req() req: AppRequest,
  ): Promise<RefundDto> {
    return this.payments.refund(this.tenantDb.tx, staffCaller(req), id, body);
  }

  @Get(':id/receipt')
  @RequirePermission('payments.read')
  @ApiOperation({ summary: 'What the printed receipt shows' })
  receipt(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<ReceiptDto> {
    return this.payments.receipt(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post(':id/receipt/sms')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('payments.accept')
  @ApiOperation({ summary: 'Text the receipt to the member' })
  async sendReceipt(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<void> {
    await this.payments.sendReceiptSms(this.tenantDb.tx, staffCaller(req), id);
  }
}

@ApiTags('payments')
@Controller('cash-shifts')
@RequireModule('cash_shifts')
export class CashShiftsController {
  constructor(
    private readonly shifts: CashShiftsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('cash_shifts.manage')
  @ApiOperation({ summary: 'Shifts, newest first' })
  list(
    @Query(new ZodPipe(cashShiftListQuerySchema)) query: CashShiftListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<CashShiftDto>> {
    return this.shifts.list(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get('current')
  @RequirePermission('cash_shifts.manage')
  @ApiOperation({ summary: 'The open shift at a location with running totals; null if none' })
  async current(
    @Query(new ZodPipe(cashShiftQuerySchema)) query: CashShiftQuery,
    @Req() req: AppRequest,
  ): Promise<{ shift: CashShiftDto | null }> {
    const shift = await this.shifts.current(this.tenantDb.tx, staffCaller(req), query.locationId);
    return { shift };
  }

  @Get(':id')
  @RequirePermission('cash_shifts.manage')
  @ApiOperation({ summary: 'One shift with its totals' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<CashShiftDto> {
    return this.shifts.get(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post('open')
  @RequirePermission('cash_shifts.manage')
  @ApiOperation({ summary: 'Open a shift with the cash in the drawer' })
  @ApiBody(zodBody(cashShiftOpenSchema))
  open(
    @Body(new ZodPipe(cashShiftOpenSchema)) body: CashShiftOpenInput,
    @Req() req: AppRequest,
  ): Promise<CashShiftDto> {
    return this.shifts.open(this.tenantDb.tx, staffCaller(req), body);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('cash_shifts.manage')
  @ApiOperation({ summary: 'Close with the cash counted; the difference is kept' })
  @ApiBody(zodBody(cashShiftCloseSchema))
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(cashShiftCloseSchema)) body: CashShiftCloseInput,
    @Req() req: AppRequest,
  ): Promise<CashShiftDto> {
    return this.shifts.close(this.tenantDb.tx, staffCaller(req), id, body);
  }
}

/** The member app's list of the signed-in member's payments (docs/TZ.md F-9.1). */
@ApiTags('member app')
@Controller('me/payments')
@RequireModule('payments')
export class MePaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @AnyAuthenticated()
  @ApiOperation({ summary: "The signed-in member's payments and debt (member app only)" })
  list(
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
    @Req() req: AppRequest,
  ): Promise<MemberPaymentsDto> {
    return this.payments.listOwn(this.tenantDb.tx, memberUser(req).userId, query);
  }
}
