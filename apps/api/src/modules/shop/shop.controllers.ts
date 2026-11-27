import {
  type Page,
  type ProductCreateInput,
  productCreateSchema,
  type ProductDto,
  type ProductListQuery,
  productListQuerySchema,
  type ProductUpdateInput,
  productUpdateSchema,
  type ShopReportDto,
  type ShopReportQuery,
  shopReportQuerySchema,
  type ShopReturnInput,
  shopReturnSchema,
  type ShopSaleDto,
  type ShopSaleInput,
  type ShopSaleListQuery,
  shopSaleListQuerySchema,
  shopSaleSchema,
  type StockCountInput,
  stockCountSchema,
  type StockMovementDto,
  type StockMovementListQuery,
  stockMovementListQuerySchema,
  type StockReceiptInput,
  stockReceiptSchema,
  type StockWriteOffInput,
  stockWriteOffSchema,
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
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { RequirePermission } from '../auth/auth.decorators';
import { RequireModule } from '../entitlements/entitlements.service';
import { ProductsService } from './products.service';
import { SalesService } from './sales.service';
import { ShopReportsService } from './shop-reports.service';
import { StockService } from './stock.service';

@ApiTags('shop')
@Controller('shop/products')
@RequireModule('shop')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('shop.sell')
  @ApiOperation({ summary: 'Products; with ?locationId= also their stock there' })
  list(
    @Query(new ZodPipe(productListQuerySchema)) query: ProductListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<ProductDto>> {
    return this.products.list(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get(':id')
  @RequirePermission('shop.sell')
  @ApiOperation({ summary: 'One product with its units' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.get(this.tenantDb.tx, id);
  }

  @Post()
  @RequirePermission('shop.manage')
  @ApiOperation({ summary: 'Add a product and the units it is counted and sold in' })
  @ApiBody(zodBody(productCreateSchema))
  create(
    @Body(new ZodPipe(productCreateSchema)) body: ProductCreateInput,
    @Req() req: AppRequest,
  ): Promise<ProductDto> {
    return this.products.create(this.tenantDb.tx, staffCaller(req), body);
  }

  @Patch(':id')
  @RequirePermission('shop.manage')
  @ApiOperation({ summary: 'Edit a product, its prices and units, or take it off sale' })
  @ApiBody(zodBody(productUpdateSchema))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(productUpdateSchema)) body: ProductUpdateInput,
    @Req() req: AppRequest,
  ): Promise<ProductDto> {
    return this.products.update(this.tenantDb.tx, staffCaller(req), id, body);
  }
}

@ApiTags('shop')
@Controller('shop/stock')
@RequireModule('shop')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('movements')
  @RequirePermission('shop.stock')
  @ApiOperation({ summary: 'Every change of stock, newest first' })
  movements(
    @Query(new ZodPipe(stockMovementListQuerySchema)) query: StockMovementListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<StockMovementDto>> {
    return this.stock.listMovements(this.tenantDb.tx, staffCaller(req), query);
  }

  @Post('receipts')
  @Idempotent()
  @RequirePermission('shop.stock')
  @ApiOperation({ summary: 'Goods arrived, with what they cost' })
  @ApiBody(zodBody(stockReceiptSchema))
  receive(
    @Body(new ZodPipe(stockReceiptSchema)) body: StockReceiptInput,
    @Req() req: AppRequest,
  ): Promise<StockMovementDto[]> {
    return this.stock.receive(this.tenantDb.tx, staffCaller(req), body);
  }

  @Post('write-offs')
  @Idempotent()
  @RequirePermission('shop.stock')
  @ApiOperation({ summary: 'Take goods out of stock without a sale, with a reason' })
  @ApiBody(zodBody(stockWriteOffSchema))
  writeOff(
    @Body(new ZodPipe(stockWriteOffSchema)) body: StockWriteOffInput,
    @Req() req: AppRequest,
  ): Promise<StockMovementDto[]> {
    return this.stock.writeOff(this.tenantDb.tx, staffCaller(req), body);
  }

  @Post('counts')
  @Idempotent()
  @RequirePermission('shop.stock')
  @ApiOperation({ summary: 'A stocktake: book the differences from what was counted' })
  @ApiBody(zodBody(stockCountSchema))
  count(
    @Body(new ZodPipe(stockCountSchema)) body: StockCountInput,
    @Req() req: AppRequest,
  ): Promise<StockMovementDto[]> {
    return this.stock.count(this.tenantDb.tx, staffCaller(req), body);
  }
}

@ApiTags('shop')
@Controller('shop/sales')
@RequireModule('shop')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get()
  @RequirePermission('shop.sell')
  @ApiOperation({ summary: 'Shop sales, newest first' })
  list(
    @Query(new ZodPipe(shopSaleListQuerySchema)) query: ShopSaleListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<ShopSaleDto>> {
    return this.sales.list(this.tenantDb.tx, staffCaller(req), query);
  }

  @Get(':id')
  @RequirePermission('shop.sell')
  @ApiOperation({ summary: 'One sale (its invoice id) with what was returned' })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest): Promise<ShopSaleDto> {
    return this.sales.get(this.tenantDb.tx, staffCaller(req), id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('shop.sell')
  @ApiOperation({ summary: 'Sell goods to a member or anyone, taking the payment' })
  @ApiBody(zodBody(shopSaleSchema))
  sell(
    @Body(new ZodPipe(shopSaleSchema)) body: ShopSaleInput,
    @Req() req: AppRequest,
  ): Promise<ShopSaleDto> {
    return this.sales.sell(this.tenantDb.tx, staffCaller(req), body);
  }

  @Post(':id/returns')
  @Idempotent()
  @RequirePermission('payments.refund')
  @ApiOperation({ summary: 'Take goods back: money back or less owed, stock back or written off' })
  @ApiBody(zodBody(shopReturnSchema))
  returnGoods(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(shopReturnSchema)) body: ShopReturnInput,
    @Req() req: AppRequest,
  ): Promise<ShopSaleDto> {
    return this.sales.returnGoods(this.tenantDb.tx, staffCaller(req), id, body);
  }
}

@ApiTags('shop')
@Controller('shop/reports')
@RequireModule('shop')
export class ShopReportsController {
  constructor(
    private readonly reports: ShopReportsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('summary')
  @RequirePermission('shop.reports')
  @ApiOperation({ summary: 'Revenue, cost, profit and losses per product in a period' })
  summary(
    @Query(new ZodPipe(shopReportQuerySchema)) query: ShopReportQuery,
    @Req() req: AppRequest,
  ): Promise<ShopReportDto> {
    return this.reports.summary(this.tenantDb.tx, staffCaller(req), query);
  }
}
