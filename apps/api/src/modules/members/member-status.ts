import type { MemberStatus, MembershipStatus, MembershipSummaryDto } from '@gatefit/shared';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

/**
 * A member's status (docs/TZ.md F-1.3): `blocked` is set by staff and stays; then `debtor`
 * when money is owed past its due moment; otherwise it follows the memberships.
 */
export function memberStatusFrom(
  current: MemberStatus,
  memberships: readonly MembershipStatus[],
  debtor = false,
): MemberStatus {
  if (current === 'blocked') {
    return current;
  }
  if (debtor) {
    return 'debtor';
  }
  if (memberships.includes('active')) {
    return 'active';
  }
  if (memberships.includes('frozen')) {
    return 'frozen';
  }
  if (memberships.includes('expired')) {
    return 'expired';
  }
  return 'inactive';
}

/**
 * What the members module needs to know about memberships, which the plans module owns.
 * The plans module provides it; members look it up when needed (not at construction),
 * because the plans module itself depends on members.
 */
export interface MembershipFacts {
  /** Statuses of all the member's memberships. */
  statusesOf(tx: TenantTransaction, memberId: string): Promise<MembershipStatus[]>;
  /** For each member that has one, the membership in force (or next) that ends first. */
  summariesOf(
    tx: TenantTransaction,
    memberIds: readonly string[],
  ): Promise<Map<string, MembershipSummaryDto>>;
}

export const MEMBERSHIP_FACTS = Symbol('MEMBERSHIP_FACTS');

/** What the members module needs to know about money owed, which the billing module owns. */
export interface DebtFacts {
  /** Whether the member owes money past its due moment. */
  isDebtor(tx: TenantTransaction, memberId: string): Promise<boolean>;
}

export const DEBT_FACTS = Symbol('DEBT_FACTS');
