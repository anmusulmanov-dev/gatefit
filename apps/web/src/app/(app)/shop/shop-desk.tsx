'use client';

import {
  addDays,
  localDate,
  type Page,
  type ProductDto,
  type ShopReportDto,
  type ShopSaleDto,
  startOfLocalDay,
  type StockMovementDto,
} from '@gatefit/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Field } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useApiGet } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { InvoiceStatusBadge, openReceipt } from '../billing/billing-ui';
import type { MemberScope } from '../members/member-scope';
import { useMemberLocations } from '../members/member-ui';
import { useMoney } from '../plans/plan-ui';
import { ProductDialog } from './product-dialog';
import { ReturnDialog } from './return-dialog';
import { ShopSaleDialog } from './sale-dialog';
import { useProducts, useQuantity, useUnitLabel } from './shop-ui';
import { CountDialog, ReceiveDialog, WriteOffDialog } from './stock-dialogs';

type Tab = 'sales' | 'products' | 'stock' | 'report';

interface Location {
  id: string;
  name: string;
  timezone: string;
}

/** The shop (docs/TZ.md F-4.8): sales, products and their stock, deliveries, the report. */
export function ShopDesk({ scope }: { scope: MemberScope }) {
  const t = useTranslations('shop');
  const canStock = useCan('shop.stock');
  const canReport = useCan('shop.reports');
  const locations = useMemberLocations(scope);
  const [locationId, setLocationId] = useState(scope.currentLocationId ?? '');
  const [tab, setTab] = useState<Tab>('sales');
  const location =
    locations.data?.find((item) => item.id === locationId) ?? locations.data?.[0] ?? null;

  const tabs: Tab[] = [
    'sales',
    'products',
    ...(canStock ? (['stock'] as const) : []),
    ...(canReport ? (['report'] as const) : []),
  ];

  if (locations.error) {
    return <LoadFailed onRetry={locations.reload} />;
  }
  if (!locations.data) {
    return <Loading />;
  }
  if (!location) {
    return <Empty>{t('noLocation')}</Empty>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
        {locations.data.length > 1 && (
          <Select
            aria-label={t('location')}
            className="w-48"
            value={location.id}
            onChange={(event) => {
              setLocationId(event.target.value);
            }}
          >
            {locations.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div role="tablist" aria-label={t('title')} className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap',
              tab === item
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => {
              setTab(item);
            }}
          >
            {t(`tabs.${item}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'sales' && <SalesTab location={location} />}
        {tab === 'products' && <ProductsTab location={location} />}
        {tab === 'stock' && <StockTab location={location} />}
        {tab === 'report' && <ReportTab location={location} />}
      </div>
    </div>
  );
}

function SalesTab({ location }: { location: Location }) {
  const t = useTranslations('shop');
  const format = useFormatter();
  const money = useMoney();
  const canRefund = useCan('payments.refund');
  const sales = useApiGet<Page<ShopSaleDto>>(`/shop/sales?locationId=${location.id}&limit=30`);
  const [selling, setSelling] = useState(false);
  const [returning, setReturning] = useState<ShopSaleDto | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          onClick={() => {
            setSelling(true);
          }}
        >
          {t('sale.action')}
        </Button>
      </div>
      {sales.error ? (
        <LoadFailed onRetry={sales.reload} />
      ) : !sales.data ? (
        <Loading />
      ) : sales.data.items.length === 0 ? (
        <Empty>{t('sales.empty')}</Empty>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card">
          {sales.data.items.map((sale) => {
            const returnable = sale.lines.some((line) => line.returnedQuantity < line.quantity);
            return (
              <li
                key={sale.invoice.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {money(sale.invoice.totalMinor, sale.invoice.currency)}
                    <InvoiceStatusBadge status={sale.invoice.status} />
                    {sale.invoice.creditedMinor !== '0' && (
                      <Badge tone="muted">
                        {t('sales.credited', {
                          amount: money(sale.invoice.creditedMinor, sale.invoice.currency),
                        })}
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {format.dateTime(new Date(sale.invoice.createdAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                    {' · '}
                    {sale.member ? `${sale.member.lastName} ${sale.member.firstName}` : t('walkIn')}
                    {' · '}
                    {sale.lines
                      .map((line) => `${line.product.name} × ${String(line.quantity)}`)
                      .join(', ')}
                  </span>
                </div>
                <div className="flex gap-2">
                  {sale.payment && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (sale.payment) openReceipt(sale.payment.id);
                      }}
                    >
                      {t('sales.receipt')}
                    </Button>
                  )}
                  {canRefund && returnable && sale.invoice.status !== 'void' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReturning(sale);
                      }}
                    >
                      {t('sales.return')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {selling && (
        <ShopSaleDialog
          location={location}
          member={null}
          onClose={() => {
            setSelling(false);
          }}
          onDone={() => {
            setSelling(false);
            sales.reload();
          }}
        />
      )}
      {returning && (
        <ReturnDialog
          sale={returning}
          onClose={() => {
            setReturning(null);
          }}
          onDone={() => {
            setReturning(null);
            sales.reload();
          }}
        />
      )}
    </div>
  );
}

function ProductsTab({ location }: { location: Location }) {
  const t = useTranslations('shop');
  const money = useMoney();
  const quantity = useQuantity();
  const unitLabel = useUnitLabel();
  const canManage = useCan('shop.manage');
  const products = useProducts(location.id);
  const currency = useApiGet<{ currency: string }>('/organization').data?.currency ?? 'UZS';
  const [editing, setEditing] = useState<ProductDto | 'new' | null>(null);
  const [q, setQ] = useState('');
  const shown = (products.data?.items ?? []).filter((item) =>
    `${item.name} ${item.category ?? ''} ${item.barcode ?? ''}`
      .toLowerCase()
      .includes(q.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="products-search" label={t('products.search')} className="w-64">
          <Input
            id="products-search"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
            }}
          />
        </Field>
        {canManage && (
          <Button
            onClick={() => {
              setEditing('new');
            }}
          >
            {t('products.add')}
          </Button>
        )}
      </div>
      {products.error ? (
        <LoadFailed onRetry={products.reload} />
      ) : !products.data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty>{t('products.empty')}</Empty>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card">
          {shown.map((product) => (
            <li
              key={product.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {product.name}
                  {product.category && <Badge tone="muted">{product.category}</Badge>}
                  {product.stock?.low && <Badge tone="warning">{t('products.low')}</Badge>}
                  {!product.isActive && <Badge tone="muted">{t('products.inactive')}</Badge>}
                </span>
                <span className="text-muted-foreground">
                  {t('products.onHand', {
                    amount: quantity(product.stock?.onHand ?? 0, product.baseUnit),
                  })}
                  {product.stock?.valueMinor != null &&
                    ` · ${t('products.value', { amount: money(product.stock.valueMinor, product.currency) })}`}
                </span>
                <span className="text-muted-foreground">
                  {product.units
                    .filter((unit) => unit.isActive)
                    .map(
                      (unit) =>
                        `${unitLabel(unit, product.baseUnit)}${unit.priceMinor === null ? '' : ` — ${money(unit.priceMinor, product.currency)}`}`,
                    )
                    .join(' · ')}
                </span>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t('products.editNamed', { name: product.name })}
                  onClick={() => {
                    setEditing(product);
                  }}
                >
                  {t('products.edit')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ProductDialog
          product={editing === 'new' ? null : editing}
          currency={currency}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            products.reload();
          }}
        />
      )}
    </div>
  );
}

function StockTab({ location }: { location: Location }) {
  const t = useTranslations('shop');
  const format = useFormatter();
  const money = useMoney();
  const quantity = useQuantity();
  const products = useProducts(location.id);
  const movements = useApiGet<Page<StockMovementDto>>(
    `/shop/stock/movements?locationId=${location.id}&limit=50`,
  );
  const [open, setOpen] = useState<'receive' | 'writeOff' | 'count' | null>(null);
  const list = products.data?.items ?? [];
  const done = () => {
    setOpen(null);
    products.reload();
    movements.reload();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={list.length === 0}
          onClick={() => {
            setOpen('receive');
          }}
        >
          {t('stock.receive')}
        </Button>
        <Button
          variant="outline"
          disabled={list.length === 0}
          onClick={() => {
            setOpen('writeOff');
          }}
        >
          {t('stock.writeOff')}
        </Button>
        <Button
          variant="outline"
          disabled={list.length === 0}
          onClick={() => {
            setOpen('count');
          }}
        >
          {t('stock.count')}
        </Button>
      </div>
      {movements.error ? (
        <LoadFailed onRetry={movements.reload} />
      ) : !movements.data ? (
        <Loading />
      ) : movements.data.items.length === 0 ? (
        <Empty>{t('stock.empty')}</Empty>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card">
          {movements.data.items.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
            >
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {row.product.name}
                  <Badge tone={row.quantityDelta > 0 ? 'positive' : 'neutral'}>
                    {t(`stock.kinds.${row.kind}`)}
                  </Badge>
                </span>
                <span className="text-muted-foreground">
                  {format.dateTime(new Date(row.createdAt), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {row.unit && ` · ${row.unit.name} × ${String(row.unit.count)}`}
                  {row.supplier && ` · ${row.supplier}`}
                  {row.reason && ` · ${row.reason}`}
                  {row.invoice && ` · ${row.invoice.number}`}
                </span>
              </div>
              <span className="text-right text-sm tabular-nums">
                <span className="block font-semibold">
                  {row.quantityDelta > 0 ? '+' : '−'}
                  {quantity(Math.abs(row.quantityDelta), row.product.baseUnit)}
                </span>
                {row.valueDeltaMinor !== null && row.valueDeltaMinor !== '0' && (
                  <span className="block text-muted-foreground">
                    {money(row.valueDeltaMinor.replace('-', ''), row.currency)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open === 'receive' && (
        <ReceiveDialog
          locationId={location.id}
          products={list}
          onClose={() => {
            setOpen(null);
          }}
          onDone={done}
        />
      )}
      {open === 'writeOff' && (
        <WriteOffDialog
          locationId={location.id}
          products={list}
          onClose={() => {
            setOpen(null);
          }}
          onDone={done}
        />
      )}
      {open === 'count' && (
        <CountDialog
          locationId={location.id}
          products={list}
          onClose={() => {
            setOpen(null);
          }}
          onDone={done}
        />
      )}
    </div>
  );
}

function ReportTab({ location }: { location: Location }) {
  const t = useTranslations('shop');
  const money = useMoney();
  const quantity = useQuantity();
  const today = localDate(new Date(), location.timezone);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const query = new URLSearchParams({
    locationId: location.id,
    from: startOfLocalDay(from || today, location.timezone).toISOString(),
    to: startOfLocalDay(addDays(to || today, 1), location.timezone).toISOString(),
  });
  const report = useApiGet<ShopReportDto>(`/shop/reports/summary?${query.toString()}`);
  const data = report.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field id="report-from" label={t('report.from')}>
          <Input
            id="report-from"
            type="date"
            value={from}
            max={to}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field id="report-to" label={t('report.to')}>
          <Input
            id="report-to"
            type="date"
            value={to}
            min={from}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
      </div>
      {report.error ? (
        <LoadFailed onRetry={report.reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ['revenue', data.totals.revenueMinor],
                ['cost', data.totals.costMinor],
                ['profit', data.totals.profitMinor],
                ['loss', data.totals.lossMinor],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded-lg border bg-card p-3 shadow-card">
                <dt className="text-sm text-muted-foreground">{t(`report.${key}`)}</dt>
                <dd className="text-lg font-bold tabular-nums">{money(value, data.currency)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">
            {t('report.stockValue', { amount: money(data.stockValueMinor, data.currency) })}
          </p>
          {data.lines.length === 0 ? (
            <Empty>{t('report.empty')}</Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('line.product')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('report.sold')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('report.revenue')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('report.cost')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('report.profit')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('report.loss')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.lines.map((line) => (
                    <tr key={line.product.id}>
                      <td className="px-3 py-2 font-medium">{line.product.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {quantity(line.soldQuantity, line.product.baseUnit)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(line.revenueMinor, data.currency)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(line.costMinor, data.currency)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(line.profitMinor, data.currency)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(line.lossMinor, data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
