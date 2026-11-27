import type { ProductBaseUnit, ShopReportDto, ShopReportQuery } from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import type { StaffCaller } from '../../common/http/staff-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { OrganizationService } from '../tenancy/organization.service';

interface ReportRow {
  product_id: string;
  name: string;
  base_unit: ProductBaseUnit;
  sold: bigint;
  revenue: bigint;
  cost: bigint;
  loss: bigint;
}

/**
 * What the shop earned in a period (docs/TZ.md F-4.8): revenue of sales less returns,
 * their cost at the average, the profit, and the cost of goods written off or found
 * missing. Worked out from the stock movements, which are never changed.
 */
@Injectable()
export class ShopReportsService {
  constructor(private readonly organizations: OrganizationService) {}

  async summary(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: ShopReportQuery,
  ): Promise<ShopReportDto> {
    const locations =
      query.locationId !== undefined
        ? caller.locationIds === null || caller.locationIds.includes(query.locationId)
          ? [query.locationId]
          : []
        : caller.locationIds;
    const where =
      locations === null
        ? Prisma.sql`TRUE`
        : locations.length === 0
          ? Prisma.sql`FALSE`
          : Prisma.sql`m.location_id IN (${Prisma.join(locations.map((id) => Prisma.sql`${id}::uuid`))})`;
    const rows = await tx.$queryRaw<ReportRow[]>`
      SELECT p.id AS product_id, p.name, p.base_unit,
             COALESCE(SUM(-m.quantity_delta) FILTER (WHERE m.kind IN ('sale', 'return')), 0)::bigint AS sold,
             COALESCE(SUM(m.revenue_minor), 0)::bigint AS revenue,
             COALESCE(SUM(-m.value_delta_minor) FILTER (WHERE m.kind IN ('sale', 'return')), 0)::bigint AS cost,
             COALESCE(SUM(-m.value_delta_minor) FILTER (WHERE m.kind IN ('write_off', 'count_adjust')), 0)::bigint AS loss
      FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.created_at >= ${new Date(query.from)} AND m.created_at < ${new Date(query.to)}
        AND m.kind <> 'receipt' AND ${where}
      GROUP BY p.id, p.name, p.base_unit
      ORDER BY revenue DESC, p.name`;
    const [stock] = await tx.$queryRaw<{ value: bigint }[]>`
      SELECT COALESCE(SUM(m.value_minor), 0)::bigint AS value
      FROM stock_levels m WHERE ${where}`;

    let revenue = 0n;
    let cost = 0n;
    let loss = 0n;
    const lines = rows.map((row) => {
      revenue += row.revenue;
      cost += row.cost;
      loss += row.loss;
      return {
        product: { id: row.product_id, name: row.name, baseUnit: row.base_unit },
        soldQuantity: Number(row.sold),
        revenueMinor: row.revenue.toString(),
        costMinor: row.cost.toString(),
        profitMinor: (row.revenue - row.cost).toString(),
        lossMinor: row.loss.toString(),
      };
    });
    return {
      currency: await this.organizations.currency(tx, caller.organizationId),
      lines,
      totals: {
        revenueMinor: revenue.toString(),
        costMinor: cost.toString(),
        profitMinor: (revenue - cost).toString(),
        lossMinor: loss.toString(),
      },
      stockValueMinor: (stock?.value ?? 0n).toString(),
    };
  }
}
