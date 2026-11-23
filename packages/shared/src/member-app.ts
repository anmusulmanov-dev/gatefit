import type { PaymentMethod } from './billing';
import type { MemberStatus } from './members';
import type { Page } from './pagination';

// What the member app shows a signed-in member about themselves (docs/TZ.md F-9.1).
// Every /me/* endpoint answers only for the member of the session, never by id.

export interface MemberProfileDto {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: MemberStatus;
  homeLocation: { id: string; name: string };
  photoUrl: string | null;
}

export interface MemberPaymentDto {
  id: string;
  createdAt: string;
  amountMinor: string;
  /** Given back so far. */
  refundedMinor: string;
  currency: string;
  method: PaymentMethod;
  invoiceNumber: string;
  location: { id: string; name: string };
}

export interface MemberPaymentsDto extends Page<MemberPaymentDto> {
  /** Still owed across the member's invoices, per currency; empty when nothing is owed. */
  owed: { amountMinor: string; currency: string }[];
}
