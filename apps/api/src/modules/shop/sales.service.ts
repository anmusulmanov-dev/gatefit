import {
  ErrorCode,
  type Page,
  type ShopReturnInput,
  type ShopSaleDto,
  type ShopSaleInput,
  type ShopSaleListQuery,
} from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { notFound, unprocessable } from '../../common/errors/domain-errors';
import type { StaffCaller } from '../../common/http/staff-request';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { type InvoiceRow, InvoicesService, toInvoiceDto } from '../billing/invoices.service';
import { PaymentsService } from '../billing/payments.service';
import { MembersService } from '../members/members.service';
import { ProductsService } from './products.service';
import { share, StockService } from './stock.service';

/**
 * Selling goods at the desk and taking them back (docs/TZ.md F-4.8). A sale is a `shop`
 * invoice with a line per product, paid like any other; its stock goes out at the average
 * cost. A member may owe for goods without becoming a debtor; anyone else pays in full.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly members: MembersService,
    private readonly products: ProductsService,
    private readonly stock: StockService,
  ) {}

  async sell(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: ShopSaleInput,
  ): Promise<ShopSaleDto> {
    await this.products.assertLocation(tx, caller, input.locationId);
    const lines = await this.stock.resolve(tx, input.lines, true);
    const charged = await this.invoices.charge(tx, caller, {
      memberId: input.memberId ?? null,
      kind: 'shop',
      locationId: input.locationId,
      dueOn: input.dueOn,
      payment: input.payment,
      items: lines.map((line) => ({
        kind: 'product',
        description: `${line.product.name} (${line.unit.name})`,
        quantity: line.count,
        unitMinor: line.unit.priceMinor ?? 0n,
      })),
    });
    // Stock rows are locked in one order, so two sales cannot wait on each other.
    const order = lines
      .map((line, index) => ({ line, itemId: charged.itemIds[index] ?? '' }))
      .sort((a, b) => a.line.product.id.localeCompare(b.line.product.id));
    for (const { line, itemId } of order) {
      await this.stock.apply(tx, caller, {
        productId: line.product.id,
        locationId: input.locationId,
        kind: 'sale',
        quantityDelta: -line.base,
        revenueMinor: (line.unit.priceMinor ?? 0n) * BigInt(line.count),
        unit: { name: line.unit.name, count: line.count, base: line.unit.baseQuantity },
        invoiceId: charged.invoice.id,
        invoiceItemId: itemId,
      });
    }
    return this.toSaleDto(tx, charged.invoice);
  }

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: ShopSaleListQuery,
  ): Promise<Page<ShopSaleDto>> {
    const page = await this.invoices.list(tx, caller, {
      ...query,
      kind: 'shop',
    });
    const items: ShopSaleDto[] = [];
    for (const invoice of page.items) {
      items.push(await this.toSaleDto(tx, await this.invoices.findVisible(tx, caller, invoice.id)));
    }
    return { items, nextCursor: page.nextCursor };
  }

  async get(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<ShopSaleDto> {
    return this.toSaleDto(tx, await this.findSale(tx, caller, id));
  }

  /**
   * Takes goods back: their price comes off the invoice (money paid beyond the new total
   * is given back, latest payment first), and they return to stock at what they cost, or
   * are written off at once when unfit to sell.
   */
  async returnGoods(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: ShopReturnInput,
  ): Promise<ShopSaleDto> {
    const invoice = await this.invoices.lock(tx, (await this.findSale(tx, caller, id)).id);
    const movements = await this.stock.movementsOfItems(
      tx,
      invoice.items.map((item) => item.id),
    );
    let credit = 0n;
    const planned = [];
    const asked = new Map<string, number>();
    for (const line of input.lines) {
      const item = invoice.items.find((candidate) => candidate.id === line.invoiceItemId);
      const sale = movements.find(
        (row) => row.invoiceItemId === line.invoiceItemId && row.kind === 'sale',
      );
      if (!item || !sale) {
        throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Not a line of this sale');
      }
      const unitBase = sale.unitBase ?? 1;
      const soldBase = -sale.quantityDelta;
      const returnedBase = movements
        .filter((row) => row.invoiceItemId === item.id && row.kind === 'return')
        .reduce((sum, row) => sum + row.quantityDelta, 0);
      const earlier = asked.get(item.id) ?? 0;
      const base = line.quantity * unitBase;
      if (returnedBase + earlier + base > soldBase) {
        throw unprocessable(ErrorCode.RETURN_EXCEEDS_SOLD, 'More than was sold', {
          invoiceItemId: item.id,
          returnable: (soldBase - returnedBase - earlier) / unitBase,
        });
      }
      asked.set(item.id, earlier + base);
      // The sale's cost, shared out so that returning everything gives back exactly all of it.
      const saleCost = -sale.valueDeltaMinor;
      const before = returnedBase + earlier;
      const value = share(saleCost, before + base, soldBase) - share(saleCost, before, soldBase);
      const price = item.unitMinor * BigInt(line.quantity);
      credit += price;
      planned.push({ line, sale, base, value, price });
    }

    const refunds = await this.payments.creditInvoice(tx, caller, invoice.id, credit, input.reason);
    for (const { line, sale, base, value, price } of planned.sort((a, b) =>
      a.sale.productId.localeCompare(b.sale.productId),
    )) {
      const unit = sale.unitName
        ? { name: sale.unitName, count: line.quantity, base: sale.unitBase ?? 1 }
        : undefined;
      await this.stock.apply(tx, caller, {
        productId: sale.productId,
        locationId: sale.locationId,
        kind: 'return',
        quantityDelta: base,
        valueDeltaMinor: value,
        revenueMinor: -price,
        unit,
        reason: input.reason,
        invoiceId: invoice.id,
        invoiceItemId: line.invoiceItemId,
      });
      if (!line.restock) {
        await this.stock.apply(tx, caller, {
          productId: sale.productId,
          locationId: sale.locationId,
          kind: 'write_off',
          quantityDelta: -base,
          valueDeltaMinor: -value,
          unit,
          reason: input.reason,
          invoiceId: invoice.id,
        });
      }
    }
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'shop.return',
      entity: 'invoice',
      entityId: invoice.id,
      after: {
        reason: input.reason,
        creditMinor: credit.toString(),
        refunds: refunds.map((refund) => ({ id: refund.id, amountMinor: refund.amountMinor })),
        lines: input.lines,
      },
    });
    return this.get(tx, caller, invoice.id);
  }

  private async findSale(tx: TenantTransaction, caller: StaffCaller, id: string) {
    const invoice = await this.invoices.findVisible(tx, caller, id);
    if (invoice.kind !== 'shop') {
      throw notFound('Sale');
    }
    return invoice;
  }

  private async toSaleDto(tx: TenantTransaction, invoice: InvoiceRow): Promise<ShopSaleDto> {
    const movements = await this.stock.movementsOfItems(
      tx,
      invoice.items.map((item) => item.id),
    );
    const contacts = invoice.memberId
      ? await this.members.contactsOf(tx, [invoice.memberId])
      : new Map<string, { id: string; firstName: string; lastName: string }>();
    const member = invoice.memberId ? contacts.get(invoice.memberId) : undefined;
    return {
      invoice: toInvoiceDto(invoice, this.clock.now()),
      member: member
        ? { id: member.id, firstName: member.firstName, lastName: member.lastName }
        : null,
      lines: invoice.items.flatMap((item) => {
        const sale = movements.find((row) => row.invoiceItemId === item.id && row.kind === 'sale');
        if (!sale) {
          return [];
        }
        const unitBase = sale.unitBase ?? 1;
        const returnedBase = movements
          .filter((row) => row.invoiceItemId === item.id && row.kind === 'return')
          .reduce((sum, row) => sum + row.quantityDelta, 0);
        return [
          {
            invoiceItemId: item.id,
            product: sale.product,
            unitName: sale.unitName ?? '',
            quantity: item.quantity,
            returnedQuantity: Math.floor(returnedBase / unitBase),
            unitMinor: item.unitMinor.toString(),
            totalMinor: item.totalMinor.toString(),
          },
        ];
      }),
      payment: await this.invoices.latestPayment(tx, invoice.id),
    };
  }
}
