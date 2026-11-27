import type {
  CashShiftDto,
  InvoiceDto,
  MemberDto,
  Page,
  PaymentDto,
  ProductDto,
  ReceiptDto,
  ShopReportDto,
  ShopSaleDto,
  StockMovementDto,
} from '@gatefit/shared';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { Location, Organization, PrismaClient } from '../src/generated/prisma/client';
import { DebtStatusJob } from '../src/modules/billing/debt-status.job';
import {
  apiAs,
  cookiesFor,
  createPlan,
  createStaff,
  createTestApp,
  type TestApp,
} from './support/app';
import { createAdminClient, createOrganization, uniquePhone } from './support/db';

// 5 kg of protein powder bought for 350 000.00, sold by the 30 g portion at 15 000.00.
const BAG_COST = '35000000';
const PORTION_PRICE = '1500000';

describe('Shop (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;
  let one: Location;
  let two: Location;
  let owner: ReturnType<typeof apiAs>;
  /** Works at One only: sells, cannot receive goods, manage products, refund or see costs. */
  let receptionist: ReturnType<typeof apiAs>;
  let ownerB: ReturnType<typeof apiAs>;

  const createProduct = async (name = 'Whey') =>
    (
      await owner
        .post('/shop/products', {
          name,
          baseUnit: 'gram',
          lowStockThreshold: 1000,
          units: [
            { name: 'Bag 5 kg', baseQuantity: 5000, priceMinor: null },
            { name: 'Portion', baseQuantity: 30, priceMinor: PORTION_PRICE },
          ],
        })
        .expect(201)
    ).body as ProductDto;
  const unit = (product: ProductDto, name: string) =>
    product.units.find((candidate) => candidate.name === name)?.id ?? '';
  const receiveBag = async (product: ProductDto, location = one, bags = 1) =>
    owner
      .post('/shop/stock/receipts', {
        locationId: location.id,
        supplier: 'Sport Market',
        lines: [
          {
            productId: product.id,
            unitId: unit(product, 'Bag 5 kg'),
            quantity: bags,
            costMinor: (BigInt(BAG_COST) * BigInt(bags)).toString(),
          },
        ],
      })
      .expect(201);
  const stockOf = async (product: ProductDto, location = one) => {
    const page = (await owner.get(`/shop/products?locationId=${location.id}&limit=100`).expect(200))
      .body as Page<ProductDto>;
    return page.items.find((item) => item.id === product.id)?.stock;
  };
  const sell = (body: object, as = owner, key?: string) =>
    as.post('/shop/sales', { locationId: one.id, ...body }, key);
  const portions = (product: ProductDto, quantity: number) => ({
    productId: product.id,
    unitId: unit(product, 'Portion'),
    quantity,
  });
  const createMember = async (): Promise<MemberDto> =>
    (
      await owner
        .post('/members', {
          firstName: 'Aziz',
          lastName: 'Karimov',
          phone: uniquePhone(),
          homeLocationId: one.id,
        })
        .expect(201)
    ).body as MemberDto;
  const currentShift = async () =>
    (
      (await owner.get(`/cash-shifts/current?locationId=${one.id}`).expect(200)).body as {
        shift: CashShiftDto | null;
      }
    ).shift;

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    const saasPlan = await createPlan(admin, 'start');
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');
    for (const organization of [orgA, orgB]) {
      await admin.organization.update({
        where: { id: organization.id },
        data: { saasPlanId: saasPlan.id },
      });
    }
    const location = (name: string) =>
      admin.location.create({ data: { organizationId: orgA.id, name, timezone: 'Asia/Tashkent' } });
    one = await location('One');
    two = await location('Two');
    owner = apiAs(t, orgA, await cookiesFor(t, orgA, await createStaff(admin, orgA, 'owner')));
    const receptionistUser = await createStaff(admin, orgA, 'receptionist');
    await admin.staffLocation.create({
      data: { organizationId: orgA.id, staffId: receptionistUser.staffId, locationId: one.id },
    });
    receptionist = apiAs(t, orgA, await cookiesFor(t, orgA, receptionistUser));
    ownerB = apiAs(t, orgB, await cookiesFor(t, orgB, await createStaff(admin, orgB, 'owner')));
  });

  afterEach(async () => {
    t.clock.reset();
    const shift = await currentShift();
    if (shift) {
      await owner
        .post(`/cash-shifts/${shift.id}/close`, { countedMinor: shift.totals.expectedMinor })
        .expect(200);
    }
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  describe('products', () => {
    it('adds a product with its units, in the organization currency', async () => {
      const product = await createProduct();
      expect(product).toMatchObject({ baseUnit: 'gram', currency: 'UZS', isActive: true });
      expect(product.units.map((item) => [item.name, item.baseQuantity, item.priceMinor])).toEqual([
        ['Bag 5 kg', 5000, null],
        ['Portion', 30, PORTION_PRICE],
      ]);
      const audit = await admin.auditLog.findMany({
        where: { organizationId: orgA.id, action: 'product.create', entityId: product.id },
      });
      expect(audit).toHaveLength(1);
    });

    it('changes prices and adds units, but keeps a unit’s size', async () => {
      const product = await createProduct();
      const portion = product.units.find((item) => item.name === 'Portion');
      const updated = (
        await owner
          .patch(`/shop/products/${product.id}`, {
            units: [
              { id: portion?.id, name: 'Portion', baseQuantity: 30, priceMinor: '1600000' },
              { name: 'Gram', baseQuantity: 1, priceMinor: '50000' },
            ],
          })
          .expect(200)
      ).body as ProductDto;
      expect(updated.units.map((item) => [item.name, item.priceMinor])).toEqual([
        ['Bag 5 kg', null],
        ['Portion', '1600000'],
        ['Gram', '50000'],
      ]);
      const refused = await owner
        .patch(`/shop/products/${product.id}`, {
          units: [{ id: portion?.id, name: 'Portion', baseQuantity: 25, priceMinor: '1600000' }],
        })
        .expect(422);
      expect(refused.body).toMatchObject({ code: 'PRODUCT_UNIT_FIXED' });
    });

    it('keeps barcodes unique', async () => {
      const barcode = `BC-${String(Date.now())}`;
      await owner
        .post('/shop/products', {
          name: 'Water',
          baseUnit: 'piece',
          barcode,
          units: [{ name: 'Bottle', baseQuantity: 1, priceMinor: '500000' }],
        })
        .expect(201);
      const taken = await owner
        .post('/shop/products', {
          name: 'Other water',
          baseUnit: 'piece',
          barcode,
          units: [{ name: 'Bottle', baseQuantity: 1, priceMinor: '500000' }],
        })
        .expect(409);
      expect(taken.body).toMatchObject({ code: 'PRODUCT_BARCODE_TAKEN' });
    });

    it('lets the desk sell but not manage products or receive goods', async () => {
      const product = await createProduct();
      await receptionist
        .post('/shop/products', { name: 'X', baseUnit: 'piece', units: [] })
        .expect(403);
      await receptionist
        .post('/shop/stock/receipts', {
          locationId: one.id,
          lines: [
            {
              productId: product.id,
              unitId: unit(product, 'Bag 5 kg'),
              quantity: 1,
              costMinor: '1',
            },
          ],
        })
        .expect(403);
      await receptionist.get('/shop/products').expect(200);
    });
  });

  describe('selling by the portion (the 5 kg bag)', () => {
    it('receives a bag, sells portions and lowers the stock in grams', async () => {
      const product = await createProduct();
      await receiveBag(product);
      expect(await stockOf(product)).toMatchObject({
        onHand: 5000,
        valueMinor: BAG_COST,
        low: false,
      });

      const sale = (
        await sell(
          {
            lines: [portions(product, 3)],
            payment: { method: 'card_terminal', amountMinor: '4500000' },
          },
          receptionist,
        ).expect(201)
      ).body as ShopSaleDto;
      expect(sale.invoice).toMatchObject({
        kind: 'shop',
        memberId: null,
        status: 'paid',
        totalMinor: '4500000',
      });
      expect(sale.lines).toEqual([
        expect.objectContaining({ unitName: 'Portion', quantity: 3, returnedQuantity: 0 }),
      ]);
      expect(sale.payment).toMatchObject({ member: null, amountMinor: '4500000' });

      // 90 g of 5000 g: 90 / 5000 of 350 000.00 = 6 300.00.
      expect(await stockOf(product)).toMatchObject({ onHand: 4910, valueMinor: '34370000' });
      const movements = (
        await owner.get(`/shop/stock/movements?productId=${product.id}`).expect(200)
      ).body as Page<StockMovementDto>;
      expect(
        movements.items.map((row) => [row.kind, row.quantityDelta, row.valueDeltaMinor]),
      ).toEqual([
        ['sale', -90, '-630000'],
        ['receipt', 5000, BAG_COST],
      ]);

      // The desk does not see what goods cost.
      const seen = (
        await receptionist.get(`/shop/products?locationId=${one.id}&limit=100`).expect(200)
      ).body as Page<ProductDto>;
      expect(seen.items.find((item) => item.id === product.id)?.stock).toMatchObject({
        onHand: 4910,
        valueMinor: null,
      });
    });

    it('refuses to sell more than is in stock, and writes nothing', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const refused = await sell({
        lines: [portions(product, 200)],
        payment: { method: 'card_terminal', amountMinor: '300000000' },
      }).expect(422);
      expect(refused.body).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: { productId: product.id, onHand: 5000 },
      });
      expect(await stockOf(product)).toMatchObject({ onHand: 5000 });
      expect(
        await admin.invoice.count({ where: { organizationId: orgA.id, totalMinor: 300000000n } }),
      ).toBe(0);
    });

    it('makes someone who is not a member pay in full at once', async () => {
      const product = await createProduct();
      await receiveBag(product);
      for (const payment of [undefined, { method: 'card_terminal', amountMinor: '1000000' }]) {
        const refused = await sell({ lines: [portions(product, 1)], payment }).expect(422);
        expect(refused.body).toMatchObject({ code: 'WALK_IN_FULL_PAYMENT' });
      }
      expect(await stockOf(product)).toMatchObject({ onHand: 5000 });
    });

    it('takes cash only with an open shift, and counts it in the shift', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const body = {
        lines: [portions(product, 2)],
        payment: { method: 'cash', amountMinor: '3000000' },
      };
      const refused = await sell(body).expect(409);
      expect(refused.body).toMatchObject({ code: 'CASH_SHIFT_NOT_OPEN' });
      expect(await stockOf(product)).toMatchObject({ onHand: 5000 });

      await owner.post('/cash-shifts/open', { locationId: one.id, openingMinor: '0' }).expect(201);
      await sell(body).expect(201);
      expect((await currentShift())?.totals).toMatchObject({ cashInMinor: '3000000' });
    });

    it('sells to a member on credit without making them a debtor', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const member = await createMember();
      const sale = (await sell({ memberId: member.id, lines: [portions(product, 2)] }).expect(201))
        .body as ShopSaleDto;
      expect(sale.invoice).toMatchObject({ status: 'open', balanceMinor: '3000000' });
      expect(sale.member).toMatchObject({ id: member.id, firstName: 'Aziz' });

      // Owed since the sale; the hourly debt job passes it by.
      await t.app.get(DebtStatusJob).run(new Date(Date.now() + 3 * 86_400_000));
      const after = (await owner.get(`/members/${member.id}`).expect(200)).body as MemberDto;
      expect(after.status).not.toBe('debtor');

      // The debt is paid like any invoice.
      await owner
        .post(`/invoices/${sale.invoice.id}/payments`, {
          method: 'card_terminal',
          amountMinor: '3000000',
        })
        .expect(201);
    });

    it('replays a repeated sale instead of selling twice', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const body = {
        lines: [portions(product, 1)],
        payment: { method: 'card_terminal', amountMinor: PORTION_PRICE },
      };
      const first = await sell(body, owner, 'shop-sale-replay-key-1').expect(201);
      const again = await sell(body, owner, 'shop-sale-replay-key-1').expect(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect((again.body as ShopSaleDto).invoice.id).toBe((first.body as ShopSaleDto).invoice.id);
      expect(await stockOf(product)).toMatchObject({ onHand: 4970 });
    });

    it('prints a receipt for anyone but texts it only to members', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const sale = (
        await sell({
          lines: [portions(product, 1)],
          payment: { method: 'card_terminal', amountMinor: PORTION_PRICE },
        }).expect(201)
      ).body as ShopSaleDto;
      const receipt = (await owner.get(`/payments/${sale.payment?.id}/receipt`).expect(200))
        .body as ReceiptDto;
      expect(receipt).toMatchObject({
        member: null,
        items: [{ kind: 'product', description: 'Whey (Portion)', quantity: 1 }],
      });
      const sms = await owner.post(`/payments/${sale.payment?.id}/receipt/sms`).expect(422);
      expect(sms.body).toMatchObject({ code: 'RECEIPT_NO_MEMBER' });
    });

    it('keeps stock per location', async () => {
      const product = await createProduct();
      await receiveBag(product, two);
      expect(await stockOf(product, one)).toMatchObject({ onHand: 0 });
      expect(await stockOf(product, two)).toMatchObject({ onHand: 5000 });
      // The desk at One cannot sell from Two.
      const refused = await sell(
        {
          locationId: two.id,
          lines: [portions(product, 1)],
          payment: { method: 'card_terminal', amountMinor: PORTION_PRICE },
        },
        receptionist,
      ).expect(403);
      expect(refused.body).toMatchObject({ code: 'LOCATION_NOT_ASSIGNED' });
    });
  });

  describe('returns', () => {
    it('gives money back and returns goods to stock at what they cost', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const sale = (
        await sell({
          lines: [portions(product, 3)],
          payment: { method: 'card_terminal', amountMinor: '4500000' },
        }).expect(201)
      ).body as ShopSaleDto;
      const item = sale.lines[0]?.invoiceItemId ?? '';

      await receptionist
        .post(`/shop/sales/${sale.invoice.id}/returns`, {
          reason: 'Wrong taste',
          lines: [{ invoiceItemId: item, quantity: 1, restock: true }],
        })
        .expect(403);
      const returned = (
        await owner
          .post(`/shop/sales/${sale.invoice.id}/returns`, {
            reason: 'Wrong taste',
            lines: [{ invoiceItemId: item, quantity: 1, restock: true }],
          })
          .expect(201)
      ).body as ShopSaleDto;
      expect(returned.invoice).toMatchObject({
        status: 'paid',
        creditedMinor: PORTION_PRICE,
        paidMinor: '3000000',
        balanceMinor: '0',
      });
      expect(returned.lines[0]).toMatchObject({ quantity: 3, returnedQuantity: 1 });
      const payment = (await owner.get(`/payments/${sale.payment?.id}`).expect(200))
        .body as PaymentDto;
      expect(payment.refundedMinor).toBe(PORTION_PRICE);
      expect(await stockOf(product)).toMatchObject({ onHand: 4940, valueMinor: '34580000' });

      // The rest comes back too, and then nothing more.
      await owner
        .post(`/shop/sales/${sale.invoice.id}/returns`, {
          reason: 'Wrong taste',
          lines: [{ invoiceItemId: item, quantity: 2, restock: true }],
        })
        .expect(201);
      expect(await stockOf(product)).toMatchObject({ onHand: 5000, valueMinor: BAG_COST });
      const more = await owner
        .post(`/shop/sales/${sale.invoice.id}/returns`, {
          reason: 'Wrong taste',
          lines: [{ invoiceItemId: item, quantity: 1, restock: true }],
        })
        .expect(422);
      expect(more.body).toMatchObject({ code: 'RETURN_EXCEEDS_SOLD' });
      const audit = await admin.auditLog.findMany({
        where: { organizationId: orgA.id, action: 'shop.return', entityId: sale.invoice.id },
      });
      expect(audit).toHaveLength(2);
    });

    it('lowers what a member owes instead of paying out, and writes off spoiled goods', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const member = await createMember();
      const sale = (await sell({ memberId: member.id, lines: [portions(product, 2)] }).expect(201))
        .body as ShopSaleDto;
      const returned = (
        await owner
          .post(`/shop/sales/${sale.invoice.id}/returns`, {
            reason: 'Torn bag',
            lines: [{ invoiceItemId: sale.lines[0]?.invoiceItemId, quantity: 1, restock: false }],
          })
          .expect(201)
      ).body as ShopSaleDto;
      expect(returned.invoice).toMatchObject({
        status: 'open',
        balanceMinor: PORTION_PRICE,
        paidMinor: '0',
      });
      expect(await admin.refund.count({ where: { invoiceId: sale.invoice.id } })).toBe(0);
      // The portion is gone: back in and written off at once.
      expect(await stockOf(product)).toMatchObject({ onHand: 4940 });
      const kinds = (
        (await owner.get(`/shop/stock/movements?productId=${product.id}`).expect(200))
          .body as Page<StockMovementDto>
      ).items.map((row) => [row.kind, row.quantityDelta]);
      expect(kinds.slice(0, 2)).toEqual([
        ['write_off', -30],
        ['return', 30],
      ]);
    });
  });

  describe('stock corrections and the report', () => {
    it('writes off, books a stocktake and reports revenue, cost, profit and losses', async () => {
      const product = await createProduct(`Report ${String(Date.now())}`);
      await receiveBag(product);
      const from = new Date(Date.now() - 60_000).toISOString();
      await sell({
        lines: [portions(product, 10)],
        payment: { method: 'card_terminal', amountMinor: '15000000' },
      }).expect(201);
      await owner
        .post('/shop/stock/write-offs', {
          locationId: one.id,
          reason: 'Expired',
          lines: [{ productId: product.id, unitId: unit(product, 'Portion'), quantity: 5 }],
        })
        .expect(201);
      // Books say 4550 g; 4500 g counted.
      const counted = (
        await owner
          .post('/shop/stock/counts', {
            locationId: one.id,
            note: 'Monthly count',
            lines: [{ productId: product.id, counted: 4500 }],
          })
          .expect(201)
      ).body as StockMovementDto[];
      expect(counted.map((row) => [row.kind, row.quantityDelta])).toEqual([['count_adjust', -50]]);
      expect(await stockOf(product)).toMatchObject({ onHand: 4500, low: false });
      await receptionist
        .post('/shop/stock/counts', {
          locationId: one.id,
          lines: [{ productId: product.id, counted: 1 }],
        })
        .expect(403);

      const to = new Date(Date.now() + 60_000).toISOString();
      const report = (
        await owner
          .get(
            `/shop/reports/summary?locationId=${one.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          )
          .expect(200)
      ).body as ShopReportDto;
      const line = report.lines.find((row) => row.product.id === product.id);
      // 300 g sold: 300/5000 of 350 000.00 = 21 000.00; 150 g + 50 g lost: 14 000.00.
      expect(line).toMatchObject({
        soldQuantity: 300,
        revenueMinor: '15000000',
        costMinor: '2100000',
        profitMinor: '12900000',
        lossMinor: '1400000',
      });
      await receptionist
        .get(`/shop/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
        .expect(403);
    });

    it('marks a product running low', async () => {
      const product = await createProduct();
      await receiveBag(product);
      await owner
        .post('/shop/stock/counts', {
          locationId: one.id,
          lines: [{ productId: product.id, counted: 900 }],
        })
        .expect(201);
      expect(await stockOf(product)).toMatchObject({ onHand: 900, low: true });
    });

    it('never changes or deletes a stock movement, and stock never goes below zero', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const [movement] = (
        (await owner.get(`/shop/stock/movements?productId=${product.id}`).expect(200))
          .body as Page<StockMovementDto>
      ).items;
      const id = movement?.id ?? '';
      const db = t.app.get(TenantDb);
      await expect(
        db.run(orgA.id, (tx) =>
          tx.stockMovement.update({ where: { id }, data: { quantityDelta: 1 } }),
        ),
      ).rejects.toThrow();
      await expect(
        db.run(orgA.id, (tx) => tx.stockMovement.delete({ where: { id } })),
      ).rejects.toThrow();
      await expect(
        db.run(orgA.id, (tx) =>
          tx.stockLevel.updateMany({ where: { productId: product.id }, data: { onHand: -1 } }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('organization isolation (acceptance criterion 10)', () => {
    it('B sees and changes none of A’s goods, stock or sales', async () => {
      const product = await createProduct();
      await receiveBag(product);
      const sale = (
        await sell({
          lines: [portions(product, 1)],
          payment: { method: 'card_terminal', amountMinor: PORTION_PRICE },
        }).expect(201)
      ).body as ShopSaleDto;

      await ownerB.get(`/shop/products/${product.id}`).expect(404);
      await ownerB.patch(`/shop/products/${product.id}`, { name: 'Mine' }).expect(404);
      await ownerB.get(`/shop/sales/${sale.invoice.id}`).expect(404);
      await ownerB
        .post(`/shop/sales/${sale.invoice.id}/returns`, {
          reason: 'X',
          lines: [{ invoiceItemId: sale.lines[0]?.invoiceItemId, quantity: 1, restock: true }],
        })
        .expect(404);
      const products = (await ownerB.get('/shop/products?limit=100').expect(200))
        .body as Page<ProductDto>;
      expect(products.items).toEqual([]);
      const movements = (await ownerB.get('/shop/stock/movements?limit=100').expect(200))
        .body as Page<StockMovementDto>;
      expect(movements.items).toEqual([]);
      const sales = (await ownerB.get('/shop/sales?limit=100').expect(200))
        .body as Page<ShopSaleDto>;
      expect(sales.items).toEqual([]);

      const seen = await t.app.get(TenantDb).run(orgB.id, async (tx) => ({
        products: await tx.product.count({ where: { organizationId: orgA.id } }),
        units: await tx.productUnit.count({ where: { organizationId: orgA.id } }),
        levels: await tx.stockLevel.count({ where: { organizationId: orgA.id } }),
        movements: await tx.stockMovement.count({ where: { organizationId: orgA.id } }),
      }));
      expect(seen).toEqual({ products: 0, units: 0, levels: 0, movements: 0 });
      const invoice = (await owner.get(`/invoices/${sale.invoice.id}`).expect(200))
        .body as InvoiceDto;
      expect(invoice.kind).toBe('shop');
    });
  });
});
