import {
  ErrorCode,
  type Page,
  type ProductCreateInput,
  type ProductDto,
  type ProductListQuery,
  type ProductUpdateInput,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { OrganizationService } from '../tenancy/organization.service';

export const productInclude = {
  units: { where: { deletedAt: null }, orderBy: { id: 'asc' } },
} as const satisfies Prisma.ProductInclude;

export type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

interface StockRow {
  locationId: string;
  onHand: number;
  valueMinor: bigint;
}

/** What the audit trail keeps of a product. */
function snapshot(dto: ProductDto): Prisma.InputJsonObject {
  return {
    name: dto.name,
    category: dto.category,
    barcode: dto.barcode,
    baseUnit: dto.baseUnit,
    lowStockThreshold: dto.lowStockThreshold,
    ikpuCode: dto.ikpuCode,
    vatRateBp: dto.vatRateBp,
    isActive: dto.isActive,
    units: dto.units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      baseQuantity: unit.baseQuantity,
      priceMinor: unit.priceMinor,
      isActive: unit.isActive,
    })),
  };
}

/** Whether the caller may see what goods cost (docs/ADR/0013-shop.md). */
export const seesCosts = (caller: StaffCaller) => caller.permissions.has('shop.reports');

export function toProductDto(
  row: ProductRow,
  stock: StockRow | null,
  showCost: boolean,
  locationId?: string,
): ProductDto {
  const onHand = stock?.onHand ?? 0;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    barcode: row.barcode,
    baseUnit: row.baseUnit,
    lowStockThreshold: row.lowStockThreshold,
    ikpuCode: row.ikpuCode,
    vatRateBp: row.vatRateBp,
    currency: row.currency,
    isActive: row.isActive,
    units: row.units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      baseQuantity: unit.baseQuantity,
      priceMinor: unit.priceMinor === null ? null : unit.priceMinor.toString(),
      isActive: unit.isActive,
    })),
    stock: locationId
      ? {
          locationId,
          onHand,
          valueMinor: showCost ? (stock?.valueMinor ?? 0n).toString() : null,
          low: row.lowStockThreshold !== null && onHand <= row.lowStockThreshold,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The goods a club sells and the units they are counted in (docs/TZ.md F-4.8). Products
 * belong to the organization; their stock is kept per location by the stock service.
 * Never deleted: one no longer sold is made inactive.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: ProductListQuery,
  ): Promise<Page<ProductDto>> {
    if (query.locationId) {
      await this.assertLocation(tx, caller, query.locationId);
    }
    const page = pageArgs(query);
    const q = query.q;
    const rows = await tx.product.findMany({
      ...page,
      where: {
        ...page.where,
        deletedAt: null,
        isActive: query.active === true ? true : undefined,
        OR: q
          ? [
              { name: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
              { barcode: q },
            ]
          : undefined,
      },
      include: productInclude,
    });
    const stock = query.locationId
      ? await tx.stockLevel.findMany({
          where: { locationId: query.locationId, productId: { in: rows.map((row) => row.id) } },
          select: { productId: true, locationId: true, onHand: true, valueMinor: true },
        })
      : [];
    const byProduct = new Map(stock.map((row) => [row.productId, row]));
    return toPage(rows, query, (row) =>
      toProductDto(row, byProduct.get(row.id) ?? null, seesCosts(caller), query.locationId),
    );
  }

  async get(tx: TenantTransaction, id: string): Promise<ProductDto> {
    return toProductDto(await this.find(tx, id), null, false);
  }

  async create(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: ProductCreateInput,
  ): Promise<ProductDto> {
    if (input.barcode) {
      await this.assertBarcodeFree(tx, input.barcode, null);
    }
    const row = await tx.product.create({
      data: {
        organizationId: caller.organizationId,
        name: input.name,
        category: input.category || null,
        barcode: input.barcode || null,
        baseUnit: input.baseUnit,
        lowStockThreshold: input.lowStockThreshold ?? null,
        ikpuCode: input.ikpuCode || null,
        vatRateBp: input.vatRateBp ?? null,
        currency: await this.organizations.currency(tx, caller.organizationId),
        units: {
          create: input.units.map((unit) => ({
            // organization_id comes from the product through the composite key.
            name: unit.name,
            baseQuantity: unit.baseQuantity,
            priceMinor: unit.priceMinor === null ? null : BigInt(unit.priceMinor),
            isActive: unit.isActive ?? true,
          })),
        },
      },
      include: productInclude,
    });
    const dto = toProductDto(row, null, false);
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'product.create',
      entity: 'product',
      entityId: row.id,
      after: snapshot(dto),
    });
    return dto;
  }

  async update(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: ProductUpdateInput,
  ): Promise<ProductDto> {
    const before = await this.find(tx, id);
    if (input.barcode) {
      await this.assertBarcodeFree(tx, input.barcode, id);
    }
    await tx.product.update({
      where: { id },
      data: {
        name: input.name,
        category: input.category === undefined ? undefined : input.category || null,
        barcode: input.barcode === undefined ? undefined : input.barcode || null,
        lowStockThreshold: input.lowStockThreshold,
        ikpuCode: input.ikpuCode === undefined ? undefined : input.ikpuCode || null,
        vatRateBp: input.vatRateBp,
        isActive: input.isActive,
      },
    });
    for (const unit of input.units ?? []) {
      const priceMinor = unit.priceMinor === null ? null : BigInt(unit.priceMinor);
      if (unit.id) {
        const existing = before.units.find((candidate) => candidate.id === unit.id);
        if (!existing) {
          throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown unit of this product');
        }
        // Past movements and sales were counted with it: its size cannot change.
        if (existing.baseQuantity !== unit.baseQuantity) {
          throw unprocessable(ErrorCode.PRODUCT_UNIT_FIXED, 'A unit keeps its size');
        }
        await tx.productUnit.update({
          where: { id: unit.id },
          data: { name: unit.name, priceMinor, isActive: unit.isActive },
        });
      } else {
        await tx.productUnit.create({
          data: {
            organizationId: caller.organizationId,
            productId: id,
            name: unit.name,
            baseQuantity: unit.baseQuantity,
            priceMinor,
            isActive: unit.isActive ?? true,
          },
        });
      }
    }
    const after = toProductDto(await this.find(tx, id), null, false);
    const was = toProductDto(before, null, false);
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'product.update',
      entity: 'product',
      entityId: id,
      before: snapshot(was),
      after: snapshot(after),
    });
    return after;
  }

  /** A product that was not deleted, with its units. */
  async find(tx: TenantTransaction, id: string): Promise<ProductRow> {
    const row = await tx.product.findFirst({
      where: { id, deletedAt: null },
      include: productInclude,
    });
    if (!row) {
      throw notFound('Product');
    }
    return row;
  }

  /** A location the caller works at, or an error. */
  async assertLocation(tx: TenantTransaction, caller: StaffCaller, locationId: string) {
    const location = await this.organizations.findLocation(tx, locationId);
    if (!location) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location');
    }
    if (!canSeeLocation(caller, location.id)) {
      throw forbidden(ErrorCode.LOCATION_NOT_ASSIGNED, 'You do not work at this location');
    }
    return location;
  }

  private async assertBarcodeFree(tx: TenantTransaction, barcode: string, exceptId: string | null) {
    const taken = await tx.product.findFirst({
      where: { barcode, deletedAt: null, id: exceptId ? { not: exceptId } : undefined },
      select: { id: true },
    });
    if (taken) {
      throw conflict(ErrorCode.PRODUCT_BARCODE_TAKEN, 'Another product has this barcode', {
        productId: taken.id,
      });
    }
  }
}
