import type { MemberStatus, MembershipStatus, MembershipSummaryDto } from '@gatefit/shared';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

/**
 * A member's status from the statuses of their memberships (docs/TZ.md F-1.3). `blocked`
 * is set by staff and `debtor` by payments (stage M4); memberships do not override them.
 */
export function memberStatusFrom(
  current: MemberStatus,
  memberships: readonly MembershipStatus[],
): MemberStatus {
  if (current === 'blocked' || current === 'debtor') {
    return current;
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
