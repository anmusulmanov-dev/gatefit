'use client';

import {
  addDays,
  daysBetween,
  type DeskPaymentMethod,
  FREEZE_SOURCES,
  type FreezeSource,
  localDate,
  type MembershipDto,
  type MembershipStatus,
  newIdempotencyKey,
  type Page,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { CheckboxRow, Field, FormActions, FormMessage } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import { PaymentMethodSelect } from '../../billing/billing-ui';
import { PlanTypeBadge, useCalendarDate, useMoney } from '../../plans/plan-ui';
import type { MemberScope } from '../member-scope';
import { SellDialog } from './sell-dialog';

const statusTone: Record<MembershipStatus, 'neutral' | 'positive' | 'warning' | 'muted'> = {
  scheduled: 'neutral',
  active: 'positive',
  frozen: 'neutral',
  expired: 'muted',
  cancelled: 'muted',
};

export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  const t = useTranslations('memberships.status');
  return <Badge tone={statusTone[status]}>{t(status)}</Badge>;
}

type Open =
  | { kind: 'sell' }
  | { kind: 'freeze'; membership: MembershipDto }
  | { kind: 'unfreeze'; membership: MembershipDto }
  | { kind: 'cancel'; membership: MembershipDto }
  | null;

/** A member's memberships on their card, with selling, freezing and cancelling. */
export function MembershipsSection({
  memberId,
  homeLocationId,
  archived,
  scope,
  onChanged,
}: {
  memberId: string;
  homeLocationId: string;
  archived: boolean;
  scope: MemberScope;
  /** The member's status follows their memberships: reload the card. */
  onChanged: () => void;
}) {
  const t = useTranslations();
  const canSell = useCan('memberships.sell') && !archived;
  const canFreeze = useCan('memberships.freeze') && !archived;
  const canCancel = useCan('memberships.cancel') && !archived;
  const memberships = useApiGet<Page<MembershipDto>>(`/members/${memberId}/memberships?limit=100`);
  const [open, setOpen] = useState<Open>(null);
  const date = useCalendarDate();
  const money = useMoney();

  const close = () => {
    setOpen(null);
  };
  const done = () => {
    setOpen(null);
    memberships.reload();
    onChanged();
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="memberships-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="memberships-title" className="text-lg font-semibold">
          {t('memberships.title')}
        </h2>
        {canSell && (
          <Button
            onClick={() => {
              setOpen({ kind: 'sell' });
            }}
          >
            {t('memberships.sell.action')}
          </Button>
        )}
      </div>

      {memberships.error ? (
        <LoadFailed onRetry={memberships.reload} />
      ) : !memberships.data ? (
        <Loading />
      ) : memberships.data.items.length === 0 ? (
        <Empty>{t('memberships.empty')}</Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" aria-busy={memberships.loading}>
          {memberships.data.items.map((membership) => {
            const inForce = membership.status === 'active' || membership.status === 'frozen';
            const canEndFreeze =
              membership.status !== 'expired' &&
              membership.status !== 'cancelled' &&
              membership.freezes.some(
                (freeze) => !freeze.endedEarly && freeze.endsOn >= todayAt(membership),
              );
            return (
              <li key={membership.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{membership.plan.name}</span>
                  <PlanTypeBadge type={membership.plan.type} />
                  <MembershipStatusBadge status={membership.status} />
                </div>
                <div className="text-sm text-muted-foreground">
                  {[
                    t('memberships.period', {
                      from: date(membership.startsOn),
                      to: date(membership.endsOn),
                    }),
                    membership.daysLeft !== null &&
                      t('memberships.daysLeft', { count: membership.daysLeft }),
                    membership.visitLimit !== null &&
                      membership.visitsLeft !== null &&
                      t('memberships.visitsLeft', {
                        left: membership.visitsLeft,
                        total: membership.visitLimit,
                      }),
                    money(membership.priceMinor, membership.currency),
                    membership.location.name,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {membership.freezes.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {membership.freezes.map((freeze) => (
                      <li key={freeze.id} className="text-muted-foreground">
                        {t('memberships.freeze.row', {
                          from: date(freeze.startsOn),
                          to: date(freeze.endsOn),
                          days: freeze.days,
                          reason: freeze.reason,
                        })}
                        {freeze.source === 'member_request' &&
                          ` · ${t('memberships.freeze.sources.member_request')}`}
                        {freeze.endedEarly && ` · ${t('memberships.freeze.endedEarly')}`}
                      </li>
                    ))}
                  </ul>
                )}
                {membership.status === 'cancelled' && membership.cancelReason && (
                  <p className="text-sm text-muted-foreground">
                    {t('memberships.cancel.reasonShown', { reason: membership.cancelReason })}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {canFreeze && inForce && membership.freeze.maxDays > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOpen({ kind: 'freeze', membership });
                      }}
                    >
                      {t('memberships.freeze.action')}
                    </Button>
                  )}
                  {canFreeze && canEndFreeze && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOpen({ kind: 'unfreeze', membership });
                      }}
                    >
                      {t('memberships.unfreeze.action')}
                    </Button>
                  )}
                  {canCancel &&
                    membership.status !== 'cancelled' &&
                    membership.status !== 'expired' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setOpen({ kind: 'cancel', membership });
                        }}
                      >
                        {t('memberships.cancel.action')}
                      </Button>
                    )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open?.kind === 'sell' && (
        <SellDialog
          memberId={memberId}
          homeLocationId={homeLocationId}
          scope={scope}
          onClose={close}
          onDone={done}
        />
      )}
      {open?.kind === 'freeze' && (
        <FreezeDialog membership={open.membership} onClose={close} onDone={done} />
      )}
      {open?.kind === 'unfreeze' && (
        <UnfreezeDialog membership={open.membership} onClose={close} onDone={done} />
      )}
      {open?.kind === 'cancel' && (
        <CancelDialog membership={open.membership} onClose={close} onDone={done} />
      )}
    </section>
  );
}

/** Today in the time zone of the location the membership was sold at. */
function todayAt(membership: Pick<MembershipDto, 'location'>): string {
  return localDate(new Date(), membership.location.timezone);
}

function FreezeDialog({
  membership,
  onClose,
  onDone,
}: {
  membership: MembershipDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const date = useCalendarDate();
  const money = useMoney();
  const today = todayAt(membership);
  const limits = membership.freeze;
  const daysLeft = limits.maxDays - limits.daysUsed;
  const timesLeft = limits.maxTimes - limits.timesUsed;
  const [startsOn, setStartsOn] = useState(
    today > membership.startsOn ? today : membership.startsOn,
  );
  const [days, setDays] = useState(String(Math.max(limits.minDays, Math.min(7, daysLeft))));
  const [reason, setReason] = useState('');
  const [source, setSource] = useState<FreezeSource>('staff');
  const canTakePayment = useCan('payments.accept');
  const hasFee = limits.feeMinor !== '0';
  const [payFee, setPayFee] = useState(true);
  const [method, setMethod] = useState<DeskPaymentMethod>('cash');
  const [idempotencyKey] = useState(newIdempotencyKey);
  const dayCount = /^\d+$/.test(days) ? Number.parseInt(days, 10) : 0;
  const newEnd = dayCount > 0 ? addDays(membership.endsOn, dayCount) : null;

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim() || dayCount < 1) {
      action.fail();
      return;
    }
    action.run(
      () =>
        api.post(
          `/memberships/${membership.id}/freeze`,
          {
            startsOn,
            days: dayCount,
            reason: reason.trim(),
            source,
            ...(hasFee && canTakePayment && payFee
              ? { payment: { method, amountMinor: limits.feeMinor } }
              : {}),
          },
          { idempotencyKey },
        ),
      onDone,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('memberships.freeze.title')}
      description={t('memberships.freeze.limits', {
        days: daysLeft,
        times: timesLeft,
        min: limits.minDays,
      })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="freeze-start" label={t('memberships.freeze.startsOn')}>
            <Input
              id="freeze-start"
              type="date"
              value={startsOn}
              min={today > membership.startsOn ? today : membership.startsOn}
              max={membership.endsOn}
              onChange={(event) => {
                setStartsOn(event.target.value);
              }}
            />
          </Field>
          <Field id="freeze-days" label={t('memberships.freeze.days')}>
            <Input
              id="freeze-days"
              type="number"
              min={limits.minDays}
              max={daysLeft}
              inputMode="numeric"
              value={days}
              onChange={(event) => {
                setDays(event.target.value);
              }}
            />
          </Field>
        </div>
        <Field id="freeze-reason" label={t('memberships.freeze.reason')}>
          <Input
            id="freeze-reason"
            value={reason}
            maxLength={500}
            required
            autoFocus
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <Field id="freeze-source" label={t('memberships.freeze.source')}>
          <Select
            id="freeze-source"
            value={source}
            onChange={(event) => {
              setSource(event.target.value as FreezeSource);
            }}
          >
            {FREEZE_SOURCES.map((value) => (
              <option key={value} value={value}>
                {t(`memberships.freeze.sources.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        {newEnd && (
          <p className="text-sm">
            {t('memberships.freeze.newEnd', {
              date: date(newEnd),
              until: date(addDays(startsOn, dayCount - 1)),
            })}
          </p>
        )}
        {hasFee && (
          <p className="text-sm text-muted-foreground">
            {t('memberships.freeze.fee', { amount: money(limits.feeMinor, membership.currency) })}
          </p>
        )}
        {hasFee && canTakePayment && (
          <div className="flex flex-wrap items-center gap-3">
            <CheckboxRow
              label={t('billing.freeze.payNow')}
              checked={payFee}
              onChange={(event) => {
                setPayFee(event.target.checked);
              }}
            />
            {payFee && (
              <div className="w-48">
                <PaymentMethodSelect id="freeze-method" value={method} onChange={setMethod} />
              </div>
            )}
          </div>
        )}
        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending}>
            {t('memberships.freeze.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}

function UnfreezeDialog({
  membership,
  onClose,
  onDone,
}: {
  membership: MembershipDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const date = useCalendarDate();
  const today = todayAt(membership);
  const current = membership.freezes.find(
    (freeze) => !freeze.endedEarly && freeze.startsOn <= today && today <= freeze.endsOn,
  );
  const next = membership.freezes.find((freeze) => freeze.startsOn > today);
  const returned = current
    ? daysBetween(current.startsOn > today ? current.startsOn : today, current.endsOn) + 1
    : (next?.days ?? 0);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('memberships.unfreeze.title')}
      description={
        current
          ? t('memberships.unfreeze.endCurrent', {
              from: date(current.startsOn),
              days: returned,
            })
          : t('memberships.unfreeze.dropPlanned', {
              from: next ? date(next.startsOn) : '',
              days: returned,
            })
      }
    >
      <FormMessage error={action.error} />
      <FormActions>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={action.pending}
          onClick={() => {
            action.run(() => api.post(`/memberships/${membership.id}/unfreeze`), onDone);
          }}
        >
          {t('memberships.unfreeze.confirm')}
        </Button>
      </FormActions>
    </Dialog>
  );
}

function CancelDialog({
  membership,
  onClose,
  onDone,
}: {
  membership: MembershipDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const [reason, setReason] = useState('');

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) {
      action.fail();
      return;
    }
    action.run(
      () => api.post(`/memberships/${membership.id}/cancel`, { reason: reason.trim() }),
      onDone,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('memberships.cancel.title')}
      description={t('memberships.cancel.description', { plan: membership.plan.name })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="cancel-reason" label={t('memberships.cancel.reason')}>
          <Input
            id="cancel-reason"
            value={reason}
            maxLength={500}
            required
            autoFocus
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="destructive" disabled={action.pending}>
            {t('memberships.cancel.confirm')}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
}
