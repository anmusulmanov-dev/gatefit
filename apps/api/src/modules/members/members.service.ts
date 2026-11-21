import {
  ErrorCode,
  type MemberBlockInput,
  type MemberCreateInput,
  type MemberDto,
  type MemberDuplicatesDto,
  type MemberDuplicatesQuery,
  type MemberFilter,
  type MemberListQuery,
  type MemberSource,
  type MemberStatus,
  type MemberSummaryDto,
  type MemberUpdateInput,
  MEMBER_PHOTO_MAX_BYTES,
  type Page,
} from '@gatefit/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { Clock } from '../../common/clock/clock';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../common/http/staff-request';
import { pageArgs, toPage } from '../../common/pagination/paginate';
import type { TenantTransaction } from '../../common/prisma/prisma.service';
import { uuidv7 } from '../../common/ids/uuid-v7';
import { FileLinksService } from '../../common/storage/file-links.service';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage';
import type { Prisma } from '../../generated/prisma/client';
import { imageType } from './image-type';
import { searchConditions } from './member-search';

export const memberInclude = { homeLocation: { select: { id: true, name: true } } } as const;

export type MemberRow = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;

const MAX_SIMILAR = 5;

/** `YYYY-MM-DD` of a DATE column, which Prisma reads as midnight UTC. */
const toIsoDate = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const fromIsoDate = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00Z`);

/** Fields a person typed about a member: the audit trail records which ones changed, not their values. */
const PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'birthDate',
  'gender',
  'source',
  'notes',
  'emergencyContactName',
  'emergencyContactPhone',
  'homeLocationId',
] as const;

/**
 * Members of a club (docs/TZ.md F-1.1 to F-1.3). Staff of a location-bound role see only
 * members whose home location is one of theirs; organization-wide roles see everyone.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly links: FileLinksService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: MemberListQuery,
  ): Promise<Page<MemberDto>> {
    const page = pageArgs(query, 'desc');
    const rows = await tx.member.findMany({
      ...page,
      where: { AND: [page.where, this.filterWhere(caller, query)] },
      include: memberInclude,
    });
    return toPage(rows, query, (row) => this.toDto(row));
  }

  async get(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MemberDto> {
    return this.toDto(await this.findVisible(tx, caller, id));
  }

  async create(
    tx: TenantTransaction,
    caller: StaffCaller,
    input: MemberCreateInput,
  ): Promise<MemberDto> {
    await this.assertLocation(tx, caller, input.homeLocationId);
    this.assertBirthDate(input.birthDate);
    await this.assertPhoneFree(tx, input.phone);

    const member = await tx.member.create({
      data: {
        organizationId: caller.organizationId,
        homeLocationId: input.homeLocationId,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        birthDate: fromIsoDate(input.birthDate),
        gender: input.gender ?? null,
        source: input.source ?? null,
        notes: input.notes ?? null,
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
      },
      include: memberInclude,
    });

    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'member.create',
      entity: 'member',
      entityId: member.id,
      after: { homeLocationId: member.homeLocationId, source: member.source },
    });
    return this.toDto(member);
  }

  async update(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: MemberUpdateInput,
  ): Promise<MemberDto> {
    const member = await this.findEditable(tx, caller, id);
    if (input.homeLocationId !== undefined && input.homeLocationId !== member.homeLocationId) {
      await this.assertLocation(tx, caller, input.homeLocationId);
    }
    this.assertBirthDate(input.birthDate);
    if (input.phone !== undefined && input.phone !== member.phone) {
      await this.assertPhoneFree(tx, input.phone);
    }

    const updated = await tx.member.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        birthDate: fromIsoDate(input.birthDate),
        gender: input.gender,
        source: input.source,
        notes: input.notes,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        homeLocationId: input.homeLocationId,
        // A new phone is a different person signing in to the member app.
        userId: input.phone !== undefined && input.phone !== member.phone ? null : undefined,
      },
      include: memberInclude,
    });

    const before = this.toDto(member);
    const after = this.toDto(updated);
    const changed = PROFILE_FIELDS.filter((field) =>
      field === 'homeLocationId'
        ? before.homeLocation.id !== after.homeLocation.id
        : before[field] !== after[field],
    );
    if (changed.length > 0) {
      await this.audit.record(tx, caller.organizationId, caller.actor, {
        action: 'member.update',
        entity: 'member',
        entityId: id,
        after: { fields: changed },
      });
    }
    return after;
  }

  /** Bars the member from entering until unblocked. */
  async block(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: MemberBlockInput,
  ): Promise<MemberDto> {
    const member = await this.findEditable(tx, caller, id);
    const updated = await tx.member.update({
      where: { id },
      data: { status: 'blocked', blockedReason: input.reason },
      include: memberInclude,
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'member.block',
      entity: 'member',
      entityId: id,
      before: { status: member.status },
      after: { status: 'blocked', reason: input.reason },
    });
    return this.toDto(updated);
  }

  async unblock(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MemberDto> {
    const member = await this.findEditable(tx, caller, id);
    if (member.status !== 'blocked') {
      return this.toDto(member);
    }
    // Memberships do not exist yet (stage M3), so an unblocked member has none in force.
    // M3 replaces this with the status their memberships give them.
    const status: MemberStatus = 'inactive';
    const updated = await tx.member.update({
      where: { id },
      data: { status, blockedReason: null },
      include: memberInclude,
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'member.unblock',
      entity: 'member',
      entityId: id,
      before: { status: member.status, reason: member.blockedReason },
      after: { status },
    });
    return this.toDto(updated);
  }

  /** Hides the member from lists. The phone stays taken, so a returning member is restored. */
  async archive(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MemberDto> {
    const member = await this.findVisible(tx, caller, id);
    if (member.deletedAt) {
      return this.toDto(member);
    }
    const updated = await tx.member.update({
      where: { id },
      data: { deletedAt: this.clock.now() },
      include: memberInclude,
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'member.archive',
      entity: 'member',
      entityId: id,
    });
    return this.toDto(updated);
  }

  async restore(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MemberDto> {
    const member = await this.findVisible(tx, caller, id);
    if (!member.deletedAt) {
      return this.toDto(member);
    }
    const updated = await tx.member.update({
      where: { id },
      data: { deletedAt: null },
      include: memberInclude,
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'member.restore',
      entity: 'member',
      entityId: id,
    });
    return this.toDto(updated);
  }

  /**
   * Members that the one being entered may duplicate (docs/TZ.md F-1.2). A phone match is
   * reported whatever the caller's locations, since that phone cannot be used again.
   */
  async duplicates(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: MemberDuplicatesQuery,
  ): Promise<MemberDuplicatesDto> {
    const notSelf = query.excludeId ? { id: { not: query.excludeId } } : {};
    const phoneMatch = query.phone
      ? await tx.member.findFirst({
          where: { phone: query.phone, ...notSelf },
          include: memberInclude,
        })
      : null;

    let similar: MemberRow[] = [];
    if (query.firstName && query.lastName) {
      similar = await tx.member.findMany({
        where: {
          AND: [
            this.visibleTo(caller),
            notSelf,
            { firstName: { equals: query.firstName, mode: 'insensitive' } },
            { lastName: { equals: query.lastName, mode: 'insensitive' } },
            query.birthDate ? { birthDate: fromIsoDate(query.birthDate) } : {},
            phoneMatch ? { id: { not: phoneMatch.id } } : {},
          ],
        },
        orderBy: { id: 'desc' },
        take: MAX_SIMILAR,
        include: memberInclude,
      });
    }
    return {
      phoneMatch: phoneMatch && toSummary(phoneMatch),
      similar: similar.map(toSummary),
    };
  }

  /**
   * Replaces the member's photo. The image type is read from the file itself, not trusted
   * from the upload.
   */
  async setPhoto(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    file: { buffer: Buffer; size: number } | undefined,
  ): Promise<MemberDto> {
    if (!file) {
      throw unprocessable(ErrorCode.FILE_REQUIRED, 'Attach the photo as "file"');
    }
    if (file.size > MEMBER_PHOTO_MAX_BYTES) {
      throw unprocessable(ErrorCode.FILE_TOO_LARGE, 'The photo is too large');
    }
    const type = imageType(file.buffer);
    if (!type) {
      throw unprocessable(ErrorCode.UNSUPPORTED_FILE_TYPE, 'Use a JPEG, PNG or WebP image');
    }
    const member = await this.findEditable(tx, caller, id);

    const key = `orgs/${caller.organizationId}/members/${id}/photo-${uuidv7(this.clock.now())}.${type.extension}`;
    await this.storage.put(key, file.buffer, type.contentType);
    const updated = await tx.member.update({
      where: { id },
      data: { photoKey: key },
      include: memberInclude,
    });
    await this.removeFile(member.photoKey);
    return this.toDto(updated);
  }

  async removePhoto(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MemberDto> {
    const member = await this.findEditable(tx, caller, id);
    const updated = await tx.member.update({
      where: { id },
      data: { photoKey: null },
      include: memberInclude,
    });
    await this.removeFile(member.photoKey);
    return this.toDto(updated);
  }

  // Storage is not part of the transaction. Should the transaction fail after this, the
  // member keeps a key without a file and shows no photo; a person can upload it again.
  private async removeFile(key: string | null): Promise<void> {
    if (key) {
      await this.storage.delete(key);
    }
  }

  toDto(row: MemberRow): MemberDto {
    return {
      ...toDtoWithoutPhoto(row),
      photoUrl: row.photoKey ? this.links.link(row.photoKey) : null,
    };
  }

  /** Members of the list and the export: not archived, visible to the caller, filtered. */
  filterWhere(caller: StaffCaller, filter: MemberFilter): Prisma.MemberWhereInput {
    return {
      AND: [
        this.visibleTo(caller),
        { deletedAt: null, status: filter.status, homeLocationId: filter.locationId },
        ...searchConditions(filter.q),
      ],
    };
  }

  /** Prisma filter for the members the caller may see. */
  visibleTo(caller: StaffCaller): Prisma.MemberWhereInput {
    return caller.locationIds === null ? {} : { homeLocationId: { in: [...caller.locationIds] } };
  }

  private async findVisible(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
  ): Promise<MemberRow> {
    const member = await tx.member.findFirst({
      where: { AND: [{ id }, this.visibleTo(caller)] },
      include: memberInclude,
    });
    if (!member) {
      throw notFound('Member');
    }
    return member;
  }

  private async findEditable(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
  ): Promise<MemberRow> {
    const member = await this.findVisible(tx, caller, id);
    if (member.deletedAt) {
      throw conflict(ErrorCode.MEMBER_ARCHIVED, 'Restore the member before changing them');
    }
    return member;
  }

  private async assertLocation(
    tx: TenantTransaction,
    caller: StaffCaller,
    locationId: string,
  ): Promise<void> {
    const location = await tx.location.findFirst({ where: { id: locationId, deletedAt: null } });
    if (!location) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location');
    }
    if (!canSeeLocation(caller, locationId)) {
      throw forbidden(
        ErrorCode.LOCATION_NOT_ASSIGNED,
        'You can only add members to locations you work at',
      );
    }
  }

  private assertBirthDate(birthDate: string | null | undefined): void {
    const today = this.clock.now().toISOString().slice(0, 10);
    if (birthDate && birthDate > today) {
      throw unprocessable(ErrorCode.VALIDATION_FAILED, 'Birth date cannot be in the future');
    }
  }

  // Checked up front rather than by catching the unique violation: a failed statement
  // would abort the request's transaction.
  private async assertPhoneFree(tx: TenantTransaction, phone: string): Promise<void> {
    const existing = await tx.member.findFirst({ where: { phone }, include: memberInclude });
    if (existing) {
      throw conflict(ErrorCode.MEMBER_PHONE_TAKEN, 'A member with this phone already exists', {
        member: toSummary(existing),
      });
    }
  }
}

export function toSummary(row: MemberRow): MemberSummaryDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    birthDate: toIsoDate(row.birthDate),
    status: row.status,
    homeLocation: row.homeLocation,
    archived: row.deletedAt !== null,
  };
}

function toDtoWithoutPhoto(row: MemberRow): Omit<MemberDto, 'photoUrl'> {
  return {
    ...toSummary(row),
    gender: row.gender,
    source: row.source as MemberSource | null,
    notes: row.notes,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    blockedReason: row.blockedReason,
    createdAt: row.createdAt.toISOString(),
  };
}
