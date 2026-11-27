import {
  currencyDigits,
  ErrorCode,
  localDate,
  MEMBER_FILE_MAX_BYTES,
  MEMBERSHIP_IMPORT_MAX_ROWS,
  type MembershipImportDto,
  type MembershipImportField,
  type MembershipImportMapping,
  membershipImportMappingSchema,
  type MembershipImportRevertInput,
  type MembershipImportRowErrorDto,
  type MembershipImportValidateInput,
  type Page,
  type PageQuery,
  type Permission,
} from '@gatefit/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { AuditService } from '../../../common/audit/audit.service';
import { Clock } from '../../../common/clock/clock';
import { conflict, notFound, unprocessable } from '../../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../../common/http/staff-request';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import { pageArgs, toPage } from '../../../common/pagination/paginate';
import type { TenantTransaction } from '../../../common/prisma/prisma.service';
import { QueueService } from '../../../common/queue/queue.service';
import { FILE_STORAGE, type FileStorage, readAll } from '../../../common/storage/file-storage';
import { TenantDb } from '../../../common/tenancy/tenant-db.service';
import type { MembershipImport, Prisma } from '../../../generated/prisma/client';
import { AccessService } from '../../access/access.service';
import { InvoicesService } from '../../billing/invoices.service';
import {
  detectFormat,
  readSheet,
  type SheetData,
  UnreadableFileError,
} from '../../members/import/member-file';
import { normalizePhone } from '../../members/import/member-rows';
import { MembersService } from '../../members/members.service';
import { OrganizationService } from '../../tenancy/organization.service';
import { MembershipsService } from '../memberships.service';
import { PlansService, readRestrictions } from '../plans.service';
import {
  type MembershipCandidate,
  suggestMembershipMapping,
  validateMembershipRows,
} from './membership-rows';

const QUEUE_NAME = 'membership-imports';
const SAMPLE_ROWS = 5;
const MAX_LISTED_ERRORS = 1000;
/** Rows written per transaction: each one may bill a debt too. */
const BATCH_SIZE = 100;

interface ImportJob {
  organizationId: string;
  importId: string;
  kind: 'write' | 'revert';
}

/** The request's transaction has not been committed yet: try again shortly. */
class NotQueuedYet extends Error {}

/**
 * Bringing in memberships already running in another system (docs/TZ.md F-1.4.1): upload,
 * choose what each column means and check every row, then write the valid rows in a
 * background job. Nothing is sold and no money is taken; what is still owed is billed.
 * An import can be undone while no one has come in on its memberships or paid for them.
 */
@Injectable()
export class MembershipImportsService implements OnModuleInit {
  private readonly logger = new Logger(MembershipImportsService.name);
  private queue!: Queue<ImportJob>;

  constructor(
    private readonly queues: QueueService,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly members: MembersService,
    private readonly plans: PlansService,
    private readonly memberships: MembershipsService,
    private readonly organizations: OrganizationService,
    private readonly invoices: InvoicesService,
    private readonly access: AccessService,
  ) {}

  onModuleInit(): void {
    this.queue = this.queues.queue<ImportJob>(QUEUE_NAME);
    this.queues.worker<ImportJob>(QUEUE_NAME, (job) => this.process(job));
  }

  async list(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: PageQuery,
  ): Promise<Page<MembershipImportDto>> {
    const page = pageArgs(query, 'desc');
    const rows = await tx.membershipImport.findMany({
      ...page,
      where: {
        ...page.where,
        deletedAt: null,
        ...(caller.locationIds === null ? {} : { createdBy: caller.actor.userId }),
      },
    });
    const currency = await this.organizations.currency(tx, caller.organizationId);
    return toPage(rows, query, (row) => toDto(row, currency));
  }

  async upload(
    tx: TenantTransaction,
    caller: StaffCaller,
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
  ): Promise<MembershipImportDto> {
    if (!file) {
      throw unprocessable(ErrorCode.FILE_REQUIRED, 'Attach the file as "file"');
    }
    if (file.size > MEMBER_FILE_MAX_BYTES) {
      throw unprocessable(ErrorCode.FILE_TOO_LARGE, 'The file is too large');
    }
    const sheet = await this.read(file.buffer);
    if (sheet.rows.length > MEMBERSHIP_IMPORT_MAX_ROWS) {
      throw unprocessable(
        ErrorCode.IMPORT_TOO_MANY_ROWS,
        `A file may hold at most ${MEMBERSHIP_IMPORT_MAX_ROWS} memberships`,
        { max: MEMBERSHIP_IMPORT_MAX_ROWS },
      );
    }

    const id = uuidv7(this.clock.now());
    const extension = detectFormat(file.buffer);
    const fileKey = `orgs/${caller.organizationId}/membership-imports/${id}.${extension}`;
    await this.storage.put(
      fileKey,
      file.buffer,
      extension === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
    );
    const created = await tx.membershipImport.create({
      data: {
        id,
        organizationId: caller.organizationId,
        createdBy: caller.actor.userId,
        staffId: caller.staffId,
        locationIds: caller.locationIds === null ? undefined : [...caller.locationIds],
        fileKey,
        fileName: file.originalname.slice(0, 200),
        headers: sheet.headers,
        mapping: suggestMembershipMapping(sheet.headers),
        sampleRows: sheet.rows.slice(0, SAMPLE_ROWS),
        totalRows: sheet.rows.length,
      },
    });
    return toDto(created, await this.organizations.currency(tx, caller.organizationId));
  }

  async get(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MembershipImportDto> {
    const row = await this.find(tx, caller, id);
    return toDto(row, await this.organizations.currency(tx, caller.organizationId));
  }

  /** Checks every row with the chosen mapping. May be repeated until the import is started. */
  async validate(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: MembershipImportValidateInput,
  ): Promise<MembershipImportDto> {
    const current = await this.find(tx, caller, id);
    if (current.status !== 'uploaded' && current.status !== 'validated') {
      throw conflict(ErrorCode.IMPORT_ALREADY_STARTED, 'This import has already been started');
    }
    const headers = current.headers as string[];
    if (Object.values(input.mapping).some((column) => column >= headers.length)) {
      throw unprocessable(ErrorCode.VALIDATION_FAILED, 'The mapping names a missing column');
    }
    const { candidates, errors } = await this.check(tx, current, input.mapping);
    const updated = await tx.membershipImport.update({
      where: { id },
      data: {
        status: 'validated',
        mapping: input.mapping,
        validRows: candidates.length,
        debtMinor: candidates.reduce((sum, candidate) => sum + candidate.debtMinor, 0n),
        errorCount: errors.length,
        errors: errors.slice(0, MAX_LISTED_ERRORS) as unknown as Prisma.InputJsonValue,
      },
    });
    return toDto(updated, await this.organizations.currency(tx, caller.organizationId));
  }

  /** Queues the validated import. Starting it again changes nothing. */
  async commit(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
  ): Promise<MembershipImportDto> {
    const current = await this.find(tx, caller, id);
    const currency = await this.organizations.currency(tx, caller.organizationId);
    if (current.status === 'uploaded') {
      throw conflict(ErrorCode.IMPORT_NOT_VALIDATED, 'Check the rows before importing');
    }
    if (current.status !== 'validated') {
      return toDto(current, currency);
    }
    const updated = await tx.membershipImport.update({
      where: { id },
      data: { status: 'queued' },
    });
    await this.enqueue(caller.organizationId, id, 'write');
    return toDto(updated, currency);
  }

  /**
   * Undoes a finished import: its memberships are cancelled and what is owed on them is
   * written off, in the background. Refused once a member has come in on one of them or
   * paid for one; asking again changes nothing.
   */
  async revert(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: MembershipImportRevertInput,
  ): Promise<MembershipImportDto> {
    const current = await this.find(tx, caller, id);
    const currency = await this.organizations.currency(tx, caller.organizationId);
    if (current.revertedAt) {
      return toDto(current, currency);
    }
    if (current.status !== 'done') {
      throw conflict(ErrorCode.IMPORT_NOT_FINISHED, 'Only a finished import can be undone');
    }
    const ids = await this.memberships.idsOfImport(tx, id);
    if (await this.access.anyEntryOn(tx, ids)) {
      throw conflict(ErrorCode.IMPORT_REVERT_BLOCKED, 'Members have come in on these memberships', {
        reason: 'entries',
      });
    }
    if (await this.invoices.anyPaidForMemberships(tx, ids)) {
      throw conflict(ErrorCode.IMPORT_REVERT_BLOCKED, 'Money has been paid on these memberships', {
        reason: 'payments',
      });
    }
    const updated = await tx.membershipImport.update({
      where: { id },
      data: {
        revertedAt: this.clock.now(),
        revertedBy: caller.actor.userId,
        revertReason: input.reason,
      },
    });
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'membership_import.revert',
      entity: 'membership_import',
      entityId: id,
      after: { reason: input.reason, memberships: ids.length },
    });
    await this.enqueue(caller.organizationId, id, 'revert');
    return toDto(updated, currency);
  }

  /** Runs a queued write or revert. Safe to run again after a crash. */
  async process(job: Job<ImportJob>): Promise<void> {
    const { organizationId, importId, kind } = job.data;
    if (kind === 'revert') {
      await this.undo(organizationId, importId);
      return;
    }
    // A row still "running" was claimed by an attempt that crashed; this one carries on.
    const row = await this.tenantDb.run(organizationId, async (tx) => {
      await tx.membershipImport.updateMany({
        where: { id: importId, status: 'queued' },
        data: { status: 'running' },
      });
      return tx.membershipImport.findUnique({ where: { id: importId } });
    });
    if (!row || row.status === 'done' || row.status === 'failed') {
      return;
    }
    if (row.status === 'validated') {
      throw new NotQueuedYet('The import is not committed yet');
    }
    try {
      await this.write(organizationId, row);
    } catch (error) {
      if (job.attemptsMade + 1 < (job.opts.attempts ?? 1)) {
        throw error;
      }
      this.logger.error(`Membership import ${importId} failed: ${(error as Error).message}`);
      await this.tenantDb.run(organizationId, (tx) =>
        tx.membershipImport.update({
          where: { id: importId },
          data: { status: 'failed', finishedAt: this.clock.now() },
        }),
      );
    }
  }

  private async enqueue(organizationId: string, importId: string, kind: ImportJob['kind']) {
    // The job id makes a repeated request queue nothing new.
    await this.queue.add(
      kind,
      { organizationId, importId, kind },
      {
        jobId: `${kind}-${importId}`,
        attempts: 8,
        backoff: { type: 'exponential', delay: 250 },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  private async write(organizationId: string, row: MembershipImport): Promise<void> {
    const mapping = membershipImportMappingSchema.parse(row.mapping);
    const caller = uploaderOf(row);
    // Validated again: memberships may have been sold since. Rows an earlier, interrupted
    // run already wrote are skipped.
    const { candidates, written } = await this.tenantDb.run(organizationId, async (tx) => ({
      ...(await this.check(tx, row, mapping)),
      written: await this.memberships.importedRows(tx, row.id),
    }));
    const pending = candidates.filter((candidate) => !written.has(candidate.row));
    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      const batch = pending.slice(start, start + BATCH_SIZE);
      await this.tenantDb.run(organizationId, async (tx) => {
        for (const candidate of batch) {
          await this.writeOne(tx, caller, row.id, candidate);
        }
      });
    }

    await this.tenantDb.run(organizationId, async (tx) => {
      const createdCount = (await this.memberships.importedRows(tx, row.id)).size;
      const skippedCount = Math.max((row.validRows ?? 0) - createdCount, 0);
      await tx.membershipImport.update({
        where: { id: row.id },
        data: { status: 'done', createdCount, skippedCount, finishedAt: this.clock.now() },
      });
      await this.audit.record(tx, organizationId, caller.actor, {
        action: 'membership_import.finish',
        entity: 'membership_import',
        entityId: row.id,
        after: { createdCount, skippedCount },
      });
    });
  }

  private async writeOne(
    tx: TenantTransaction,
    caller: StaffCaller,
    importId: string,
    candidate: MembershipCandidate,
  ): Promise<void> {
    const membership = await this.memberships.createImported(tx, caller, {
      importId,
      importRow: candidate.row,
      memberId: candidate.memberId,
      planId: candidate.plan.id,
      locationId: candidate.location.id,
      timeZone: candidate.location.timezone,
      startsOn: candidate.startsOn,
      endsOn: candidate.endsOn,
      visitsLeft: candidate.visitsLeft,
    });
    if (candidate.debtMinor > 0n) {
      // Billing brings the member's status up to date.
      await this.invoices.charge(tx, caller, {
        memberId: candidate.memberId,
        locationId: candidate.location.id,
        dueOn: candidate.dueOn ?? undefined,
        items: [
          {
            kind: 'membership',
            description: candidate.plan.name,
            quantity: 1,
            unitMinor: candidate.debtMinor,
            membershipId: membership.id,
          },
        ],
      });
    } else {
      await this.members.refreshStatus(tx, candidate.memberId);
    }
  }

  private async undo(organizationId: string, importId: string): Promise<void> {
    const row = await this.tenantDb.run(organizationId, (tx) =>
      tx.membershipImport.findUnique({ where: { id: importId } }),
    );
    if (!row?.revertedAt) {
      return;
    }
    const caller = uploaderOf(row, row.revertedBy ?? row.createdBy);
    const reason = row.revertReason ?? 'Import undone';
    for (;;) {
      const cancelled = await this.tenantDb.run(organizationId, (tx) =>
        this.memberships.cancelImported(tx, caller, importId, reason, BATCH_SIZE),
      );
      if (cancelled < BATCH_SIZE) {
        return;
      }
    }
  }

  /** Validates every row of the stored file against the organization's data. */
  private async check(
    tx: TenantTransaction,
    row: MembershipImport,
    mapping: MembershipImportMapping,
  ): Promise<{ candidates: MembershipCandidate[]; errors: MembershipImportRowErrorDto[] }> {
    const stored = await this.storage.get(row.fileKey);
    if (!stored) {
      throw unprocessable(ErrorCode.FILE_UNREADABLE, 'The uploaded file is gone; upload it again');
    }
    const sheet = await this.read(await readAll(stored));
    const caller = uploaderOf(row);
    const organization = await this.organizations.get(tx, row.organizationId);
    const currency = await this.organizations.currency(tx, row.organizationId);
    const locations = (await this.organizations.listLocations(tx, false)).map(
      ({ id, name, timezone }) => ({ id, name, timezone }),
    );
    const plans = (await this.plans.listAll(tx)).map((plan) => ({
      id: plan.id,
      name: plan.name,
      type: plan.type,
      visitLimit: plan.type === 'single' ? 1 : plan.visitLimit,
      locationIds: readRestrictions(plan.restrictions).locationIds,
    }));

    // First pass finds the phones; the second knows the members and what they hold.
    const base = {
      country: organization.country,
      currencyDigits: currencyDigits(currency),
      plans,
      locations,
      canSee: (locationId: string) => canSeeLocation(caller, locationId),
      today: (timeZone: string) => localDate(this.clock.now(), timeZone),
    };
    const phoneColumn = mapping.phone ?? -1;
    const rawPhones = sheet.rows.map((cells) => (cells[phoneColumn] ?? '').trim());
    const phones = rawPhones.flatMap((raw) => {
      const phone = raw ? normalizePhone(raw, organization.country) : null;
      return phone ? [phone] : [];
    });
    const members = await this.members.findByPhones(tx, caller, phones);
    const existing = await this.memberships.spansOf(
      tx,
      [...members.values()].map((member) => member.id),
      row.id,
    );
    return validateMembershipRows(sheet.rows, mapping, { ...base, members, existing });
  }

  private async read(buffer: Buffer): Promise<SheetData> {
    try {
      return await readSheet(buffer);
    } catch (error) {
      if (error instanceof UnreadableFileError) {
        throw unprocessable(ErrorCode.FILE_UNREADABLE, 'The file cannot be read as CSV or XLSX');
      }
      throw error;
    }
  }

  private async find(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
  ): Promise<MembershipImport> {
    const row = await tx.membershipImport.findFirst({ where: { id, deletedAt: null } });
    // Location-bound staff see only their own uploads.
    if (!row || (caller.locationIds !== null && row.createdBy !== caller.actor.userId)) {
      throw notFound('Import');
    }
    return row;
  }
}

/**
 * The uploader as they were when uploading, for the background job: the same locations,
 * so it writes exactly what they were shown. Permissions were checked on the requests.
 */
function uploaderOf(row: MembershipImport, userId = row.createdBy): StaffCaller {
  return {
    organizationId: row.organizationId,
    actor: { userId, ip: undefined },
    staffId: row.staffId,
    permissions: new Set<Permission>(),
    locationIds: Array.isArray(row.locationIds) ? (row.locationIds as string[]) : null,
  };
}

function toDto(row: MembershipImport, currency: string): MembershipImportDto {
  return {
    id: row.id,
    status: row.status,
    fileName: row.fileName,
    headers: row.headers as string[],
    mapping: row.mapping as Partial<Record<MembershipImportField, number>>,
    sampleRows: row.sampleRows as string[][],
    totalRows: row.totalRows,
    validRows: row.validRows,
    debtMinor: row.debtMinor?.toString() ?? null,
    currency,
    errorCount: row.errorCount,
    errors: row.errors as unknown as MembershipImportRowErrorDto[],
    createdCount: row.createdCount,
    skippedCount: row.skippedCount,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    revertedAt: row.revertedAt?.toISOString() ?? null,
    revertReason: row.revertReason,
  };
}
