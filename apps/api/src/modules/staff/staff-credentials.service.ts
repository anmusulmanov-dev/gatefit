import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../common/prisma/prisma.service';

export interface StaffCredentials {
  staffId: string;
  userId: string;
  /** Argon2id hash; null when no password has been set. */
  passwordHash: string | null;
  /** Encrypted TOTP secret; null when no authenticator is enrolled. */
  totpSecret: string | null;
  mustChangePassword: boolean;
  role: { name: string; isSystem: boolean };
}

// These columns are omitted from ordinary queries (PrismaService), so they are selected
// here explicitly, and only here.
const credentialsSelect = {
  id: true,
  userId: true,
  passwordHash: true,
  totpSecret: true,
  mustChangePassword: true,
  role: { select: { name: true, isSystem: true } },
} as const;

// Someone who may sign in: an active staff record with a live role and user.
const canSignIn = {
  status: 'active',
  deletedAt: null,
  role: { deletedAt: null },
  user: { deletedAt: null },
} as const;

/**
 * Sign-in credentials of staff. They live on the staff record, inside the organization:
 * a person working at two organizations has two independent passwords, so neither
 * organization can affect sign-in at the other (docs/ADR/0003-staff-credentials.md).
 */
@Injectable()
export class StaffCredentialsService {
  findByPhone(tx: TenantTransaction, phone: string): Promise<StaffCredentials | null> {
    return this.find(tx, { user: { ...canSignIn.user, phone } });
  }

  findByUserId(tx: TenantTransaction, userId: string): Promise<StaffCredentials | null> {
    return this.find(tx, { userId });
  }

  async setPassword(
    tx: TenantTransaction,
    staffId: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void> {
    await tx.staff.update({ where: { id: staffId }, data: { passwordHash, mustChangePassword } });
  }

  /** Stores a first authenticator. Returns false, changing nothing, if one already exists. */
  async enrollTotp(tx: TenantTransaction, staffId: string, totpSecret: string): Promise<boolean> {
    const result = await tx.staff.updateMany({
      where: { id: staffId, totpSecret: null },
      data: { totpSecret },
    });
    return result.count === 1;
  }

  async clearTotp(tx: TenantTransaction, staffId: string): Promise<void> {
    await tx.staff.update({ where: { id: staffId }, data: { totpSecret: null } });
  }

  private async find(
    tx: TenantTransaction,
    where: { userId: string } | { user: { deletedAt: null; phone: string } },
  ): Promise<StaffCredentials | null> {
    const staff = await tx.staff.findFirst({
      where: { ...canSignIn, ...where },
      select: credentialsSelect,
    });
    return staff && { staffId: staff.id, ...staff };
  }
}
