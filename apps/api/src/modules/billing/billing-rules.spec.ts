import { requestHash } from '../../common/idempotency/idempotency.interceptor';
import { expectedCash } from './cash-shifts.service';
import { balanceOf, invoiceStatus } from './invoices.service';

describe('invoiceStatus', () => {
  it('follows the amounts', () => {
    expect(invoiceStatus(100n, 0n, false)).toBe('open');
    expect(invoiceStatus(100n, 1n, false)).toBe('partially_paid');
    expect(invoiceStatus(100n, 100n, false)).toBe('paid');
    expect(invoiceStatus(0n, 0n, false)).toBe('paid');
  });

  it('stays void once written off, whatever was paid', () => {
    expect(invoiceStatus(100n, 40n, true)).toBe('void');
  });

  it('goes back from paid after a refund', () => {
    expect(invoiceStatus(100n, 70n, false)).toBe('partially_paid');
  });

  it('asks only for what is left after returned goods are taken off', () => {
    expect(invoiceStatus(100n, 70n, false, 30n)).toBe('paid');
    expect(invoiceStatus(100n, 0n, false, 100n)).toBe('paid');
    expect(invoiceStatus(100n, 20n, false, 30n)).toBe('partially_paid');
  });
});

describe('balanceOf', () => {
  it('is what is left, or nothing once void', () => {
    expect(
      balanceOf({ totalMinor: 100n, creditedMinor: 0n, paidMinor: 30n, status: 'partially_paid' }),
    ).toBe(70n);
    expect(balanceOf({ totalMinor: 100n, creditedMinor: 0n, paidMinor: 30n, status: 'void' })).toBe(
      0n,
    );
  });

  it('takes returned goods off what is owed', () => {
    expect(
      balanceOf({ totalMinor: 100n, creditedMinor: 30n, paidMinor: 20n, status: 'partially_paid' }),
    ).toBe(50n);
  });

  it('handles amounts beyond what a float holds exactly', () => {
    const total = 9_007_199_254_740_993n;
    expect(
      balanceOf({ totalMinor: total, creditedMinor: 0n, paidMinor: 1n, status: 'partially_paid' }),
    ).toBe(9_007_199_254_740_992n);
  });
});

describe('expectedCash', () => {
  it('is opening plus cash in less cash refunded; card and transfer stay out', () => {
    expect(
      expectedCash(10_000n, {
        cashIn: 70_000n,
        cashRefunds: 3_000n,
        cardTerminal: 45_000n,
        transfer: 5_000n,
        paymentsCount: 5,
      }),
    ).toBe(77_000n);
  });
});

describe('requestHash', () => {
  it('differs when anything in the request differs', () => {
    const base = requestHash('POST', '/api/v1/invoices/x/payments', { amountMinor: '100' });
    expect(requestHash('POST', '/api/v1/invoices/x/payments', { amountMinor: '100' })).toBe(base);
    expect(requestHash('POST', '/api/v1/invoices/x/payments', { amountMinor: '101' })).not.toBe(
      base,
    );
    expect(requestHash('POST', '/api/v1/invoices/y/payments', { amountMinor: '100' })).not.toBe(
      base,
    );
  });
});
