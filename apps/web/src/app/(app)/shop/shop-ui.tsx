'use client';

import type { Page, ProductBaseUnit, ProductDto, ProductUnitDto } from '@gatefit/shared';
import { useFormatter, useTranslations } from 'next-intl';

import { Field } from '@/components/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useApiGet } from '@/lib/use-api';

/** A quantity in a product's base unit: "4 910 g", "12 dona". */
export function useQuantity() {
  const t = useTranslations('shop.baseUnits');
  const format = useFormatter();
  return (value: number, unit: ProductBaseUnit) => `${format.number(value)} ${t(unit)}`;
}

/** A unit as staff pick it: "Portion (30 g)". */
export function useUnitLabel() {
  const quantity = useQuantity();
  return (unit: ProductUnitDto, baseUnit: ProductBaseUnit) =>
    `${unit.name} (${quantity(unit.baseQuantity, baseUnit)})`;
}

/** Products with their stock at a location; `active` leaves out those not on sale. */
export function useProducts(locationId: string | null, active = false) {
  return useApiGet<Page<ProductDto>>(
    locationId
      ? `/shop/products?limit=100&locationId=${locationId}${active ? '&active=true' : ''}`
      : null,
  );
}

export interface LineDraft {
  productId: string;
  unitId: string;
  /** As typed: a whole number of units. */
  quantity: string;
}

/** A whole number of at least 1 from what was typed, or null. */
export function wholeNumber(typed: string, min = 1): number | null {
  const trimmed = typed.trim();
  if (!/^\d{1,7}$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value >= min ? value : null;
}

/**
 * Product, unit and how many: the line of a delivery, a write-off or a sale. `units`
 * picks which units are offered (all, or only priced ones for a sale).
 */
export function LineFields({
  idPrefix,
  products,
  value,
  onChange,
  units = (product) => product.units.filter((unit) => unit.isActive),
}: {
  idPrefix: string;
  products: ProductDto[];
  value: LineDraft;
  onChange: (value: LineDraft) => void;
  units?: (product: ProductDto) => ProductUnitDto[];
}) {
  const t = useTranslations('shop.line');
  const unitLabel = useUnitLabel();
  const quantity = useQuantity();
  const product = products.find((item) => item.id === value.productId) ?? null;
  const offered = product ? units(product) : [];

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]">
      <Field
        id={`${idPrefix}-product`}
        label={t('product')}
        hint={
          product?.stock
            ? t('inStock', { amount: quantity(product.stock.onHand, product.baseUnit) })
            : undefined
        }
      >
        <Select
          id={`${idPrefix}-product`}
          value={value.productId}
          onChange={(event) => {
            const next = products.find((item) => item.id === event.target.value);
            onChange({
              ...value,
              productId: event.target.value,
              unitId: (next ? units(next) : [])[0]?.id ?? '',
            });
          }}
        >
          <option value="">{t('choose')}</option>
          {products.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${idPrefix}-unit`} label={t('unit')}>
        <Select
          id={`${idPrefix}-unit`}
          value={value.unitId}
          disabled={!product}
          onChange={(event) => {
            onChange({ ...value, unitId: event.target.value });
          }}
        >
          {product &&
            offered.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unitLabel(unit, product.baseUnit)}
              </option>
            ))}
        </Select>
      </Field>
      <Field id={`${idPrefix}-quantity`} label={t('quantity')}>
        <Input
          id={`${idPrefix}-quantity`}
          inputMode="numeric"
          value={value.quantity}
          onChange={(event) => {
            onChange({ ...value, quantity: event.target.value });
          }}
        />
      </Field>
    </div>
  );
}
