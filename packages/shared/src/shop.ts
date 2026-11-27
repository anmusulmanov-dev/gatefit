import { z } from 'zod';
import { chargeOptionsSchema, type InvoiceDto, type PaymentDto } from './billing';
import { pageQuerySchema } from './pagination';
import { minorAmountSchema } from './platform';

// The shop: goods sold at the desk and their stock (docs/TZ.md F-4.8). Stock is counted
// in a product's base unit (pieces, grams or millilitres) as whole numbers; money is in
// minor units as strings of digits (CLAUDE.md rule 2). No floating point anywhere.

export const PRODUCT_BASE_UNITS = ['piece', 'gram', 'ml'] as const;
export type ProductBaseUnit = (typeof PRODUCT_BASE_UNITS)[number];

export const STOCK_MOVEMENT_KINDS = [
  'receipt',
  'sale',
  'return',
  'write_off',
  'count_adjust',
] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

/** The most of one base unit a single line may move: 10 tonnes in grams. */
export const MAX_BASE_QUANTITY = 10_000_000;

const nameSchema = z.string().trim().min(1).max(200);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const reasonSchema = z.string().trim().min(1).max(500);
const baseQuantitySchema = z.number().int().min(1).max(MAX_BASE_QUANTITY);
const countSchema = z.number().int().min(1).max(100_000);

/**
 * A way to count the product when buying or selling it: "Portion" = 30 g, "Bag 5 kg" =
 * 5000 g, "Piece" = 1. A unit with a price can be sold; one without is for receipts only.
 */
export const productUnitInputSchema = z.object({
  /** An existing unit to change; omitted: a new one. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(50),
  /** How many base units one of these holds. Fixed once the unit exists. */
  baseQuantity: baseQuantitySchema,
  /** Sale price of one unit; null: not sold in this unit. */
  priceMinor: minorAmountSchema.nullable(),
  isActive: z.boolean().optional(),
});
export type ProductUnitInput = z.infer<typeof productUnitInputSchema>;

const productFields = {
  name: nameSchema,
  category: optionalText(100),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{1,64}$/)
    .optional(),
  /** Below this much stock (in base units) the product shows as running low. */
  lowStockThreshold: z.number().int().min(0).max(MAX_BASE_QUANTITY).nullable().optional(),
  /** Uzbekistan's product classification code (IKPU / MXIK), for fiscal receipts later. */
  ikpuCode: z
    .string()
    .trim()
    .regex(/^\d{1,32}$/)
    .optional(),
  /** VAT rate in basis points (1200 = 12%), for fiscal receipts later. */
  vatRateBp: z.number().int().min(0).max(10_000).nullable().optional(),
};

export const productCreateSchema = z.object({
  ...productFields,
  baseUnit: z.enum(PRODUCT_BASE_UNITS),
  units: z
    .array(productUnitInputSchema.omit({ id: true }))
    .min(1)
    .max(20),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = z.object({
  name: nameSchema.optional(),
  category: z.string().trim().max(100).nullable().optional(),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{1,64}$/)
    .nullable()
    .optional(),
  lowStockThreshold: productFields.lowStockThreshold,
  ikpuCode: z
    .string()
    .trim()
    .regex(/^\d{1,32}$/)
    .nullable()
    .optional(),
  vatRateBp: productFields.vatRateBp,
  isActive: z.boolean().optional(),
  /** Units listed are changed or added; units left out stay as they are. */
  units: z.array(productUnitInputSchema).max(20).optional(),
});
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const productListQuerySchema = pageQuerySchema.extend({
  /** Name, category or barcode. */
  q: z.string().trim().max(100).optional(),
  /** Include the stock at this location. */
  locationId: z.uuid().optional(),
  /** true: only products on sale. */
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export interface ProductUnitDto {
  id: string;
  name: string;
  baseQuantity: number;
  priceMinor: string | null;
  isActive: boolean;
}

export interface ProductStockDto {
  locationId: string;
  /** In base units. */
  onHand: number;
  /** What the stock cost; null for staff who may not see costs. */
  valueMinor: string | null;
  low: boolean;
}

export interface ProductDto {
  id: string;
  name: string;
  category: string | null;
  barcode: string | null;
  baseUnit: ProductBaseUnit;
  lowStockThreshold: number | null;
  ikpuCode: string | null;
  vatRateBp: number | null;
  currency: string;
  isActive: boolean;
  units: ProductUnitDto[];
  /** Present when the list was asked for a location. */
  stock: ProductStockDto | null;
  createdAt: string;
}

const stockLineSchema = z.object({
  productId: z.uuid(),
  unitId: z.uuid(),
  /** How many of the unit. */
  quantity: countSchema,
});

/** Goods arrived, with what they cost. */
export const stockReceiptSchema = z.object({
  locationId: z.uuid(),
  supplier: optionalText(200),
  note: optionalText(500),
  lines: z
    .array(
      stockLineSchema.extend({ /** What the whole line cost. */ costMinor: minorAmountSchema }),
    )
    .min(1)
    .max(50),
});
export type StockReceiptInput = z.infer<typeof stockReceiptSchema>;

/** Goods taken out of stock without a sale: spoiled, broken, used by the club. */
export const stockWriteOffSchema = z.object({
  locationId: z.uuid(),
  reason: reasonSchema,
  lines: z.array(stockLineSchema).min(1).max(50),
});
export type StockWriteOffInput = z.infer<typeof stockWriteOffSchema>;

/** A stocktake: what was counted, in base units. The differences are booked. */
export const stockCountSchema = z.object({
  locationId: z.uuid(),
  note: optionalText(500),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        counted: z.number().int().min(0).max(MAX_BASE_QUANTITY),
      }),
    )
    .min(1)
    .max(200),
});
export type StockCountInput = z.infer<typeof stockCountSchema>;

export const stockMovementListQuerySchema = pageQuerySchema.extend({
  locationId: z.uuid().optional(),
  productId: z.uuid().optional(),
  kind: z.enum(STOCK_MOVEMENT_KINDS).optional(),
});
export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;

export interface StockMovementDto {
  id: string;
  kind: StockMovementKind;
  product: { id: string; name: string; baseUnit: ProductBaseUnit };
  location: { id: string; name: string };
  /** Signed, in base units. */
  quantityDelta: number;
  /** The unit and count as entered, when one was used. */
  unit: { name: string; count: number; baseQuantity: number } | null;
  /** Signed change of the stock's cost; null for staff who may not see costs. */
  valueDeltaMinor: string | null;
  /** Sales are positive, returns negative, others "0". */
  revenueMinor: string;
  currency: string;
  reason: string | null;
  supplier: string | null;
  invoice: { id: string; number: string } | null;
  createdAt: string;
}

export const shopSaleSchema = chargeOptionsSchema.extend({
  locationId: z.uuid(),
  /** Omitted: someone who is not a member, who pays in full at once. */
  memberId: z.uuid().optional(),
  lines: z
    .array(stockLineSchema.extend({ quantity: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(50),
});
export type ShopSaleInput = z.infer<typeof shopSaleSchema>;

export const shopReturnSchema = z.object({
  reason: reasonSchema,
  lines: z
    .array(
      z.object({
        invoiceItemId: z.uuid(),
        /** How many of the unit sold. */
        quantity: z.number().int().min(1).max(1000),
        /** false: the goods came back unfit to sell and are written off. */
        restock: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});
export type ShopReturnInput = z.infer<typeof shopReturnSchema>;

export const shopSaleListQuerySchema = pageQuerySchema.extend({
  locationId: z.uuid().optional(),
  memberId: z.uuid().optional(),
});
export type ShopSaleListQuery = z.infer<typeof shopSaleListQuerySchema>;

export interface ShopSaleLineDto {
  invoiceItemId: string;
  product: { id: string; name: string; baseUnit: ProductBaseUnit };
  unitName: string;
  /** Units sold and already returned. */
  quantity: number;
  returnedQuantity: number;
  unitMinor: string;
  totalMinor: string;
}

export interface ShopSaleDto {
  invoice: InvoiceDto;
  member: { id: string; firstName: string; lastName: string } | null;
  lines: ShopSaleLineDto[];
  /** The latest payment, for the receipt; null when nothing was paid. */
  payment: PaymentDto | null;
}

export const shopReportQuerySchema = z.object({
  locationId: z.uuid().optional(),
  /** Instants (ISO 8601): `from` inclusive, `to` exclusive. */
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
export type ShopReportQuery = z.infer<typeof shopReportQuerySchema>;

export interface ShopReportLineDto {
  product: { id: string; name: string; baseUnit: ProductBaseUnit };
  /** Sold less returned, in base units. */
  soldQuantity: number;
  revenueMinor: string;
  costMinor: string;
  /** Revenue less cost; a signed integer string. */
  profitMinor: string;
  /** Cost of goods written off or found missing; a signed integer string. */
  lossMinor: string;
}

export interface ShopReportDto {
  currency: string;
  lines: ShopReportLineDto[];
  totals: { revenueMinor: string; costMinor: string; profitMinor: string; lossMinor: string };
  /** What the stock on hand cost, now. */
  stockValueMinor: string;
}

/**
 * The cost of taking `quantity` out of a stock of `onHand` worth `valueMinor` in total: its
 * share of the value at the average cost, rounded half up. Taking all of it costs all of it.
 */
export function averageCost(valueMinor: bigint, onHand: number, quantity: number): bigint {
  if (onHand <= 0 || quantity <= 0) {
    return 0n;
  }
  if (quantity >= onHand) {
    return valueMinor;
  }
  const numerator = valueMinor * BigInt(quantity) * 2n + BigInt(onHand);
  return numerator / (BigInt(onHand) * 2n);
}
