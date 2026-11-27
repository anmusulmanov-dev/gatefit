import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { MembersModule } from '../members/members.module';
import { OrganizationModule } from '../tenancy/organization.module';
import { ProductsService } from './products.service';
import { SalesService } from './sales.service';
import {
  ProductsController,
  SalesController,
  ShopReportsController,
  StockController,
} from './shop.controllers';
import { ShopReportsService } from './shop-reports.service';
import { StockService } from './stock.service';

// Owns products, product_units, stock_levels and stock_movements (docs/TZ.md F-4.8).
// Sales are billing's invoices; this module reaches them only through billing's services
// (CLAUDE.md rule 7).
@Module({
  imports: [BillingModule, MembersModule, OrganizationModule],
  controllers: [ProductsController, StockController, SalesController, ShopReportsController],
  providers: [ProductsService, StockService, SalesService, ShopReportsService],
})
export class ShopModule {}
