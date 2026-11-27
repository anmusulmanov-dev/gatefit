import {
  averageCost,
  ErrorCode,
  MAX_BASE_QUANTITY,
  type Page,
  type StockCountInput,
  type StockMovementDto,
  type StockMovementKind,
  type StockMovementListQuery,
  type StockReceiptInput,
  type StockWriteOffInput,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { unprocessable } from '../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import { uuidv7 } from '../../common/ids/uuid-v7';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { type ProductRow, ProductsService, seesCosts } from './products.service';

const movementInclude = {
  product: { select: { id: true, name: true, baseUnit: true } },
  location: { select: { id: true, name: true } },
  invoice: { select: { id: true, number: true } },
} as const satisfies Prisma.StockMovementInclude;

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

/** Most a stock level may hold, kept well inside a 32-bit column. */
const MAX_ON_HAND = 2_000_000_000;

export function toMovementDto(row: MovementRow, showCost: boolean): StockMovementDto {
  return {
    id: row.id,
    kind: row.kind,
    product: row.product,
    location: row.location,
    quantityDelta: row.quantityDelta,
    unit:
      row.unitName !== null && row.unitCount !== null && row.unitBase !== null
        ? { name: row.unitName, count: row.unitCount, baseQuantity: row.unitBase }
        : null,
    valueDeltaMinor: showCost ? row.valueDeltaMinor.toString() : null,
    revenueMinor: row.revenueMinor.toString(),
    currency: row.currency,
    reason: row.reason,
    supplier: row.supplier,
    invoice: row.invoice,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `value * part / whole`, rounded half up, in whole minor units. */
export function share(value: bigint, part: number, whole: number): bigint {
  if (whole <= 0) {
    return 0n;
  }
  return (value * BigInt(part) * 2n + BigInt(whole)) / (BigInt(whole) * 2n);
}

export interface Move {
  productId: string;
  locationId: string;
  kind: StockMovementKind;
  /** Signed, in base units. */
  quantityDelta: number;
  /**
   * Signed change of the stock's cost. Omitted for stock going out: its share of the
   * stock's value at the average cost.
   */
  valueDeltaMinor?: bigint;
  revenueMinor?: bigint;
  unit?: { name: string; count: number; base: number };
  reason?: string | null;
  supplier?: string | null;
  invoiceId?: string;
  invoiceItemId?: string;
}

interface UnitLine {
  productId: string;
  unitId: string;
  quantity: number;
}

/**
 * Stock per location and every change of it (docs/TZ.md F-4.8). A level only changes
 * together with a movement, under a row lock, and never goes below zero. Cost follows the
 * average: goods going out take their share of what the stock cost.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly products: ProductsService,
  ) {}

  /** Applies one movement to the stock it touches and records it. */
  async apply(tx: TenantTransaction, caller: StaffCaller, move: Move): Promise<MovementRow> {
    const level = await this.lockLevel(tx, caller.organizationId, move.productId, move.locationId);
    let valueDelta = move.valueDeltaMinor ?? 0n;
    if (move.quantityDelta < 0) {
      const quantity = -move.quantityDelta;
      if (quantity > level.onHand) {
        throw unprocessable(ErrorCode.INSUFFICIENT_STOCK, 'Not enough in stock', {
          productId: move.productId,
          onHand: level.onHand,
        });
      }
      valueDelta = move.valueDeltaMinor ?? -averageCost(level.valueMinor, level.onHand, quantity);
    }
    const onHand = level.onHand + move.quantityDelta;
    if (onHand > MAX_ON_HAND) {
      throw unprocessable(ErrorCode.VALIDATION_FAILED, 'Too much stock for one product');
    }
    // Rounding can never take the value below zero, but a stock that runs out costs nothing.
    let value = level.valueMinor + valueDelta;
    if (onHand === 0 && value !== 0n) {
      valueDelta -= value;
      value = 0n;
    }
    await tx.stockLevel.update({ where: { id: level.id }, data: { onHand, valueMinor: value } });
    return tx.stockMovement.create({
      data: {
        organizationId: caller.organizationId,
        productId: move.productId,
        locationId: move.locationId,
        kind: move.kind,
        quantityDelta: move.quantityDelta,
        valueDeltaMinor: valueDelta,
        revenueMinor: move.revenueMinor ?? 0n,
        currency: level.currency,
        unitName: move.unit?.name ?? null,
        unitCount: move.unit?.count ?? null,
        unitBase: move.unit?.base ?? null,
        reason: move.reason ?? null,
        supplier: move.supplier ?? null,
        invoiceId: move.invoiceId ?? null,
        invoiceItemId: move.invoiceItemId ?? null,
        createdBy: caller.actor.userId,
      },
      include: movementInclude,
    });
  }

  /** Goods arrived, at the cost given for each line. */
  async receive(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: StockReceiptInput,
  ): Promise<StockMovementDto[]> {
    await this.products.assertLocation(tx, caller, input.locationId);
    const resolved = await this.resolve(tx, input.lines, false);
    const rows: MovementRow[] = [];
    for (const [index, line] of resolved.entries()) {
      rows.push(
        await this.apply(tx, caller, {
          productId: line.product.id,
          locationId: input.locationId,
          kind: 'receipt',
          quantityDelta: line.base,
          valueDeltaMinor: BigInt(input.lines[index]?.costMinor ?? '0'),
          unit: { name: line.unit.name, count: line.count, base: line.unit.baseQuantity },
          reason: input.note || null,
          supplier: input.supplier || null,
        }),
      );
    }
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'stock.receive',
      entity: 'location',
      entityId: input.locationId,
      after: {
        supplier: input.supplier ?? null,
        lines: rows.map((row) => ({
          productId: row.productId,
          quantity: row.quantityDelta,
          costMinor: row.valueDeltaMinor.toString(),
        })),
      },
    });
    return rows.map((row) => toMovementDto(row, true));
  }

  /** Goods taken out without a sale, at what they cost. */
  async writeOff(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: StockWriteOffInput,
  ): Promise<StockMovementDto[]> {
    await this.products.assertLocation(tx, caller, input.locationId);
    const resolved = await this.resolve(tx, input.lines, false);
    const rows: MovementRow[] = [];
    for (const line of resolved) {
      rows.push(
        await this.apply(tx, caller, {
          productId: line.product.id,
          locationId: input.locationId,
          kind: 'write_off',
          quantityDelta: -line.base,
          unit: { name: line.unit.name, count: line.count, base: line.unit.baseQuantity },
          reason: input.reason,
        }),
      );
    }
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'stock.write_off',
      entity: 'location',
      entityId: input.locationId,
      after: {
        reason: input.reason,
        lines: rows.map((row) => ({
          productId: row.productId,
          quantity: row.quantityDelta,
          costMinor: row.valueDeltaMinor.toString(),
        })),
      },
    });
    return rows.map((row) => toMovementDto(row, seesCosts(caller)));
  }

  /**
   * A stocktake: each product's counted quantity replaces what the books say, and the
   * difference is booked. Found goods are valued at the average cost, or at the last
   * receipt's when the books had none.
   */
  async count(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: StockCountInput,
  ): Promise<StockMovementDto[]> {
    await this.products.assertLocation(tx, caller, input.locationId);
    const rows: MovementRow[] = [];
    const lines = [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId));
    for (const line of lines) {
      await this.products.find(tx, line.productId);
      const level = await this.lockLevel(
        tx,
        caller.organizationId,
        line.productId,
        input.locationId,
      );
      const delta = line.counted - level.onHand;
      if (delta === 0) {
        continue;
      }
      let valueDelta: bigint | undefined;
      if (delta > 0) {
        valueDelta =
          level.onHand > 0
            ? share(level.valueMinor, delta, level.onHand)
            : await this.lastUnitCost(tx, line.productId, input.locationId, delta);
      }
      rows.push(
        await this.apply(tx, caller, {
          productId: line.productId,
          locationId: input.locationId,
          kind: 'count_adjust',
          quantityDelta: delta,
          valueDeltaMinor: valueDelta,
          reason: input.note || null,
        }),
      );
    }
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'stock.count',
      entity: 'location',
      entityId: input.locationId,
      after: {
        note: input.note ?? null,
        lines: rows.map((row) => ({
          productId: row.productId,
          quantity: row.quantityDelta,
          costMinor: row.valueDeltaMinor.toString(),
        })),
      },
    });
    return rows.map((row) => toMovementDto(row, seesCosts(caller)));
  }

  async listMovements(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: StockMovementListQuery,
  ): Promise<Page<StockMovementDto>> {
    if (query.locationId && !canSeeLocation(caller, query.locationId)) {
      return { items: [], nextCursor: null };
    }
    const page = pageArgs(query, 'desc');
    const rows = await tx.stockMovement.findMany({
      ...page,
      where: {
        ...page.where,
        productId: query.productId,
        kind: query.kind,
        locationId:
          query.locationId ??
          (caller.locationIds === null ? undefined : { in: [...caller.locationIds] }),
      },
      include: movementInclude,
    });
    return toPage(rows, query, (row) => toMovementDto(row, seesCosts(caller)));
  }

  /** The sale and return movements of invoice lines. */
  movementsOfItems(tx: TenantTransaction, invoiceItemIds: string[]) {
    return tx.stockMovement.findMany({
      where: { invoiceItemId: { in: invoiceItemIds }, kind: { in: ['sale', 'return'] } },
      include: movementInclude,
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Products and units of the lines, checked: the unit is the product's and in use, and
   * (for sales) has a price and the product is on sale. Base quantities are worked out.
   */
  async resolve(tx: TenantTransaction, lines: readonly UnitLine[], forSale: boolean) {
    const products = new Map<string, ProductRow>();
    const result = [];
    for (const line of lines) {
      let product = products.get(line.productId);
      if (!product) {
        product = await this.products.find(tx, line.productId);
        products.set(product.id, product);
      }
      const unit = product.units.find((candidate) => candidate.id === line.unitId);
      if (!unit?.isActive) {
        throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown unit of this product');
      }
      if (forSale && !product.isActive) {
        throw unprocessable(ErrorCode.PRODUCT_INACTIVE, 'This product is not on sale', {
          productId: product.id,
        });
      }
      if (forSale && unit.priceMinor === null) {
        throw unprocessable(ErrorCode.PRODUCT_UNIT_NOT_FOR_SALE, 'Not sold in this unit', {
          productId: product.id,
        });
      }
      const base = unit.baseQuantity * line.quantity;
      if (base > MAX_BASE_QUANTITY) {
        throw unprocessable(ErrorCode.VALIDATION_FAILED, 'Too much for one line');
      }
      result.push({ product, unit, count: line.quantity, base });
    }
    return result;
  }

  /** The stock row of a product at a location, created empty if missing, locked. */
  private async lockLevel(
    tx: TenantTransaction,
    organizationId: string,
    productId: string,
    locationId: string,
  ) {
    await tx.$executeRaw`
      INSERT INTO stock_levels (id, organization_id, product_id, location_id, updated_at)
      VALUES (${uuidv7(this.clock.now())}::uuid, ${organizationId}::uuid, ${productId}::uuid,
              ${locationId}::uuid, now())
      ON CONFLICT (organization_id, product_id, location_id) DO NOTHING`;
    const [row] = await tx.$queryRaw<
      { id: string; on_hand: number; value_minor: bigint; currency: string }[]
    >`
      SELECT s.id, s.on_hand, s.value_minor, p.currency
      FROM stock_levels s JOIN products p ON p.id = s.product_id
      WHERE s.product_id = ${productId}::uuid AND s.location_id = ${locationId}::uuid
      FOR UPDATE OF s`;
    if (!row) {
      throw new Error('stock level vanished');
    }
    return { id: row.id, onHand: row.on_hand, valueMinor: row.value_minor, currency: row.currency };
  }

  /** What `quantity` base units cost at the product's last receipt here; 0 if never received. */
  private async lastUnitCost(
    tx: TenantTransaction,
    productId: string,
    locationId: string,
    quantity: number,
  ): Promise<bigint> {
    const last = await tx.stockMovement.findFirst({
      where: { productId, locationId, kind: 'receipt' },
      orderBy: { id: 'desc' },
      select: { quantityDelta: true, valueDeltaMinor: true },
    });
    return last ? share(last.valueDeltaMinor, quantity, last.quantityDelta) : 0n;
  }
}
