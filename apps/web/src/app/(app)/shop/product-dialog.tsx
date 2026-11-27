'use client';

import {
  PRODUCT_BASE_UNITS,
  type ProductBaseUnit,
  type ProductDto,
  type ProductUnitInput,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { CheckboxRow, Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';

import { fromTyped, toTyped } from '../billing/billing-ui';
import { wholeNumber } from './shop-ui';

interface UnitDraft {
  id?: string;
  name: string;
  size: string;
  /** Empty: not sold in this unit. */
  price: string;
  isActive: boolean;
}

/** Adds a product or edits one: name, base unit, and the units it is bought and sold in. */
export function ProductDialog({
  product,
  currency,
  onClose,
  onSaved,
}: {
  product: ProductDto | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [baseUnit, setBaseUnit] = useState<ProductBaseUnit>(product?.baseUnit ?? 'piece');
  const [lowStock, setLowStock] = useState(
    product?.lowStockThreshold === null || product === null
      ? ''
      : String(product.lowStockThreshold),
  );
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [units, setUnits] = useState<UnitDraft[]>(
    product
      ? product.units.map((unit) => ({
          id: unit.id,
          name: unit.name,
          size: String(unit.baseQuantity),
          price: unit.priceMinor === null ? '' : toTyped(unit.priceMinor, currency),
          isActive: unit.isActive,
        }))
      : [{ name: '', size: '1', price: '', isActive: true }],
  );

  const setUnit = (index: number, change: Partial<UnitDraft>) => {
    setUnits((list) => list.map((unit, at) => (at === index ? { ...unit, ...change } : unit)));
  };

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed: ProductUnitInput[] = [];
    for (const unit of units) {
      const size = wholeNumber(unit.size);
      const price = unit.price.trim() === '' ? null : fromTyped(unit.price, currency);
      if (!unit.name.trim() || size === null || (unit.price.trim() !== '' && price === null)) {
        action.fail(t('shop.product.invalidUnit'));
        return;
      }
      parsed.push({
        ...(unit.id ? { id: unit.id } : {}),
        name: unit.name.trim(),
        baseQuantity: size,
        priceMinor: price,
        isActive: unit.isActive,
      });
    }
    const threshold = lowStock.trim() === '' ? null : wholeNumber(lowStock, 0);
    if (!name.trim() || parsed.length === 0 || (lowStock.trim() !== '' && threshold === null)) {
      action.fail();
      return;
    }
    const common = {
      name: name.trim(),
      lowStockThreshold: threshold,
      isActive,
      units: parsed,
    };
    action.run(
      () =>
        product
          ? api.patch(`/shop/products/${product.id}`, {
              ...common,
              category: category.trim() || null,
              barcode: barcode.trim() || null,
            })
          : api.post('/shop/products', {
              ...common,
              baseUnit,
              ...(category.trim() ? { category: category.trim() } : {}),
              ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
              units: parsed.map(({ id: _id, ...unit }) => unit),
            }),
      onSaved,
    );
  }

  const unitName = t(`shop.baseUnits.${baseUnit}`);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={product ? t('shop.product.titleEdit') : t('shop.product.titleNew')}
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="product-name" label={t('shop.product.name')}>
            <Input
              id="product-name"
              value={name}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <Field
            id="product-category"
            label={t('shop.product.category')}
            optional={t('common.optional')}
          >
            <Input
              id="product-category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
              }}
            />
          </Field>
          <Field
            id="product-base-unit"
            label={t('shop.product.baseUnit')}
            hint={t('shop.product.baseUnitHint')}
          >
            <Select
              id="product-base-unit"
              value={baseUnit}
              disabled={product !== null}
              onChange={(event) => {
                setBaseUnit(event.target.value as ProductBaseUnit);
              }}
            >
              {PRODUCT_BASE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {t(`shop.baseUnitNames.${unit}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="product-low"
            label={t('shop.product.lowStock')}
            hint={t('shop.product.lowStockHint', { unit: unitName })}
            optional={t('common.optional')}
          >
            <Input
              id="product-low"
              inputMode="numeric"
              value={lowStock}
              onChange={(event) => {
                setLowStock(event.target.value);
              }}
            />
          </Field>
          <Field
            id="product-barcode"
            label={t('shop.product.barcode')}
            optional={t('common.optional')}
          >
            <Input
              id="product-barcode"
              value={barcode}
              onChange={(event) => {
                setBarcode(event.target.value);
              }}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-card">
          <legend className="px-1 text-sm font-medium">{t('shop.product.units')}</legend>
          <p className="text-sm text-muted-foreground">{t('shop.product.unitsHint')}</p>
          {units.map((unit, index) => (
            <div
              key={unit.id ?? `new-${String(index)}`}
              className="grid items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <Field id={`unit-${String(index)}-name`} label={t('shop.product.unitName')}>
                <Input
                  id={`unit-${String(index)}-name`}
                  value={unit.name}
                  onChange={(event) => {
                    setUnit(index, { name: event.target.value });
                  }}
                />
              </Field>
              <Field
                id={`unit-${String(index)}-size`}
                label={t('shop.product.unitSize', { unit: unitName })}
              >
                <Input
                  id={`unit-${String(index)}-size`}
                  inputMode="numeric"
                  value={unit.size}
                  disabled={unit.id !== undefined}
                  onChange={(event) => {
                    setUnit(index, { size: event.target.value });
                  }}
                />
              </Field>
              <Field
                id={`unit-${String(index)}-price`}
                label={t('shop.product.unitPrice', { currency })}
              >
                <Input
                  id={`unit-${String(index)}-price`}
                  inputMode="decimal"
                  value={unit.price}
                  onChange={(event) => {
                    setUnit(index, { price: event.target.value });
                  }}
                />
              </Field>
              {unit.id ? (
                <CheckboxRow
                  label={t('shop.product.unitActive')}
                  className="pb-2"
                  checked={unit.isActive}
                  onChange={(event) => {
                    setUnit(index, { isActive: event.target.checked });
                  }}
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={units.length === 1}
                  onClick={() => {
                    setUnits((list) => list.filter((_, at) => at !== index));
                  }}
                >
                  {t('shop.sale.remove')}
                </Button>
              )}
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={units.length >= 20}
              onClick={() => {
                setUnits((list) => [...list, { name: '', size: '1', price: '', isActive: true }]);
              }}
            >
              {t('shop.product.addUnit')}
            </Button>
          </div>
        </fieldset>

        {product && (
          <CheckboxRow
            label={t('shop.product.isActive')}
            checked={isActive}
            onChange={(event) => {
              setIsActive(event.target.checked);
            }}
          />
        )}
        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending}>
            {t('common.save')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
