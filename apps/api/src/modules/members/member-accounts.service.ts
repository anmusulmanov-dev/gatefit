import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

/** What member sign-in needs to know about a member. */
export interface MemberAccount {
  id: string;
  userId: string | null;
}

/**
 * The link between a member of a club and their Gatefit identity (users), used by member
 * sign-in. Only members the club has registered may sign in to its member app.
 */
@Injectable()
export class MemberAccountsService {
  /** The non-archived member with this phone in the current organization. */
  async findByPhone(tx: TenantTransaction, phone: string): Promise<MemberAccount | null> {
    return tx.member.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, userId: true },
    });
  }

  /** Remembers who signs in as this member; done once, at their first sign-in. */
  async linkUser(tx: TenantTransaction, account: MemberAccount, userId: string): Promise<void> {
    if (account.userId !== userId) {
      await tx.member.update({ where: { id: account.id }, data: { userId } });
    }
  }
}
