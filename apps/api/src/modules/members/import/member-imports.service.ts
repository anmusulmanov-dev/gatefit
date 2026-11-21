import {
  ErrorCode,
  type ImportField,
  type ImportMapping,
  importMappingSchema,
  type ImportRowErrorDto,
  MEMBER_FILE_MAX_BYTES,
  MEMBER_IMPORT_MAX_ROWS,
  type MemberImportDto,
  type MemberImportValidateInput,
} from '@gatefit/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { AuditService } from '../../../common/audit/audit.service';
import { Clock } from '../../../common/clock/clock';
import { conflict, forbidden, notFound, unprocessable } from '../../../common/errors/domain-errors';
import { canSeeLocation, type StaffCaller } from '../../../common/http/staff-request';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import type { TenantTransaction } from '../../../common/prisma/prisma.service';
import { QueueService } from '../../../common/queue/queue.service';
import { FILE_STORAGE, type FileStorage, readAll } from '../../../common/storage/file-storage';
import { TenantDb } from '../../../common/tenancy/tenant-db.service';
import type { MemberImport, Prisma } from '../../../generated/prisma/client';
import { readSheet, type SheetData, UnreadableFileError, detectFormat } from './member-file';
import { type MemberCandidate, suggestMapping, validateRows } from './member-rows';

const QUEUE_NAME = 'member-imports';
const SAMPLE_ROWS = 5;
const MAX_LISTED_ERRORS = 1000;
/** Rows written per transaction. */
const BATCH_SIZE = 500;
/** Phones looked up per query. */
const LOOKUP_SIZE = 1000;

interface ImportJob {
  organizationId: string;
  importId: string;
}

/** The commit request's transaction has not been committed yet: try again shortly. */
class NotQueuedYet extends Error {}

const importInclude = { homeLocation: { select: { id: true, name: true } } } as const;
type ImportRow = Prisma.MemberImportGetPayload<{ include: typeof importInclude }>;

/**
 * Importing members from CSV or XLSX (docs/TZ.md F-1.4): upload, choose what each column
 * means and check every row, then write the valid rows in a background job.
 */
@Injectable()
export class MemberImportsService implements OnModuleInit {
  private readonly logger = new Logger(MemberImportsService.name);
  private queue!: Queue<ImportJob>;

  constructor(
    private readonly queues: QueueService,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  onModuleInit(): void {
    this.queue = this.queues.queue<ImportJob>(QUEUE_NAME);
    this.queues.worker<ImportJob>(QUEUE_NAME, (job) => this.process(job));
  }

  async upload(
    tx: TenantTransaction,
    caller: StaffCaller,
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
  ): Promise<MemberImportDto> {
    if (!file) {
      throw unprocessable(ErrorCode.FILE_REQUIRED, 'Attach the file as "file"');
    }
    if (file.size > MEMBER_FILE_MAX_BYTES) {
      throw unprocessable(ErrorCode.FILE_TOO_LARGE, 'The file is too large');
    }
    const sheet = await this.read(file.buffer);
    if (sheet.rows.length > MEMBER_IMPORT_MAX_ROWS) {
      throw unprocessable(
        ErrorCode.IMPORT_TOO_MANY_ROWS,
        `A file may hold at most ${MEMBER_IMPORT_MAX_ROWS} members`,
        { max: MEMBER_IMPORT_MAX_ROWS },
      );
    }

    const id = uuidv7(this.clock.now());
    const extension = detectFormat(file.buffer);
    const fileKey = `orgs/${caller.organizationId}/imports/${id}.${extension}`;
    await this.storage.put(
      fileKey,
      file.buffer,
      extension === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
    );

    const created = await tx.memberImport.create({
      data: {
        id,
        organizationId: caller.organizationId,
        createdBy: caller.actor.userId,
        fileKey,
        fileName: file.originalname.slice(0, 200),
        headers: sheet.headers,
        mapping: suggestMapping(sheet.headers),
        sampleRows: sheet.rows.slice(0, SAMPLE_ROWS),
        totalRows: sheet.rows.length,
      },
      include: importInclude,
    });
    return toDto(created);
  }

  async get(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MemberImportDto> {
    return toDto(await this.find(tx, caller, id));
  }

  /** Checks every row with the chosen mapping. May be repeated until the import is started. */
  async validate(
    tx: TenantTransaction,
    caller: StaffCaller,
    id: string,
    input: MemberImportValidateInput,
  ): Promise<MemberImportDto> {
    const current = await this.find(tx, caller, id);
    if (current.status !== 'uploaded' && current.status !== 'validated') {
      throw conflict(ErrorCode.IMPORT_ALREADY_STARTED, 'This import has already been started');
    }
    const location = await tx.location.findFirst({
      where: { id: input.homeLocationId, deletedAt: null },
    });
    if (!location) {
      throw unprocessable(ErrorCode.INVALID_REFERENCE, 'Unknown location');
    }
    if (!canSeeLocation(caller, location.id)) {
      throw forbidden(
        ErrorCode.LOCATION_NOT_ASSIGNED,
        'You can only import members to locations you work at',
      );
    }
    const headers = current.headers as string[];
    if (Object.values(input.mapping).some((column) => column >= headers.length)) {
      throw unprocessable(ErrorCode.VALIDATION_FAILED, 'The mapping names a missing column');
    }

    const { candidates, errors } = await this.check(tx, current, input.mapping);
    const updated = await tx.memberImport.update({
      where: { id },
      data: {
        status: 'validated',
        mapping: input.mapping,
        homeLocationId: location.id,
        validRows: candidates.length,
        errorCount: errors.length,
        errors: errors.slice(0, MAX_LISTED_ERRORS) as unknown as Prisma.InputJsonValue,
      },
      include: importInclude,
    });
    return toDto(updated);
  }

  /** Queues the validated import. Starting it again changes nothing. */
  async commit(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<MemberImportDto> {
    const current = await this.find(tx, caller, id);
    if (current.status === 'uploaded') {
      throw conflict(ErrorCode.IMPORT_NOT_VALIDATED, 'Check the rows before importing');
    }
    if (current.status !== 'validated') {
      return toDto(current);
    }
    const updated = await tx.memberImport.update({
      where: { id },
      data: { status: 'queued' },
      include: importInclude,
    });
    // The job id makes a repeated request queue nothing new.
    await this.queue.add(
      'import',
      { organizationId: caller.organizationId, importId: id },
      {
        jobId: id,
        attempts: 8,
        backoff: { type: 'exponential', delay: 250 },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
    return toDto(updated);
  }

  /**
   * Writes the members of a queued import. Safe to run again after a crash: rows already
   * written are recognised by their phone and skipped.
   */
  async process(job: Job<ImportJob>): Promise<void> {
    const { organizationId, importId } = job.data;
    // A row still "running" was claimed by an attempt that crashed; this one carries on.
    const row = await this.tenantDb.run(organizationId, async (tx) => {
      await tx.memberImport.updateMany({
        where: { id: importId, status: 'queued' },
        data: { status: 'running' },
      });
      return tx.memberImport.findUnique({ where: { id: importId } });
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
      this.logger.error(`Import ${importId} failed: ${(error as Error).message}`);
      await this.tenantDb.run(organizationId, (tx) =>
        tx.memberImport.update({
          where: { id: importId },
          data: { status: 'failed', finishedAt: this.clock.now() },
        }),
      );
    }
  }

  private async write(organizationId: string, row: MemberImport): Promise<void> {
    const mapping = importMappingSchema.parse(row.mapping);
    const homeLocationId = row.homeLocationId;
    if (!homeLocationId) {
      throw new Error('A validated import has a location');
    }

    // Validated again: phones may have been taken since. Members this import already
    // wrote (an earlier, interrupted run) count as taken and are not written twice.
    const { candidates } = await this.tenantDb.run(organizationId, (tx) =>
      this.check(tx, row, mapping),
    );
    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE);
      await this.tenantDb.run(organizationId, (tx) =>
        tx.member.createMany({
          data: batch.map((candidate) => this.toMember(organizationId, row, candidate)),
          // A phone taken in between is skipped rather than failing the batch.
          skipDuplicates: true,
        }),
      );
    }

    await this.tenantDb.run(organizationId, async (tx) => {
      const createdCount = await tx.member.count({ where: { importId: row.id } });
      const skippedCount = Math.max((row.validRows ?? 0) - createdCount, 0);
      await tx.memberImport.update({
        where: { id: row.id },
        data: { status: 'done', createdCount, skippedCount, finishedAt: this.clock.now() },
      });
      await this.audit.record(
        tx,
        organizationId,
        { userId: row.createdBy, ip: undefined },
        {
          action: 'member.import',
          entity: 'member_import',
          entityId: row.id,
          after: { homeLocationId, createdCount, skippedCount },
        },
      );
    });
  }

  private toMember(
    organizationId: string,
    row: MemberImport,
    candidate: MemberCandidate,
  ): Prisma.MemberCreateManyInput {
    return {
      id: uuidv7(this.clock.now()),
      organizationId,
      homeLocationId: row.homeLocationId ?? '',
      importId: row.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      phone: candidate.phone,
      birthDate: candidate.birthDate ? new Date(`${candidate.birthDate}T00:00:00Z`) : null,
      gender: candidate.gender,
      source: candidate.source,
      notes: candidate.notes,
      emergencyContactName: candidate.emergencyContactName,
      emergencyContactPhone: candidate.emergencyContactPhone,
    };
  }

  /** Validates every row of the stored file, including against existing members. */
  private async check(
    tx: TenantTransaction,
    row: MemberImport,
    mapping: ImportMapping,
  ): Promise<{ candidates: MemberCandidate[]; errors: ImportRowErrorDto[] }> {
    const stored = await this.storage.get(row.fileKey);
    if (!stored) {
      throw unprocessable(ErrorCode.FILE_UNREADABLE, 'The uploaded file is gone; upload it again');
    }
    const sheet = await this.read(await readAll(stored));
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: row.organizationId },
      select: { country: true },
    });
    const options = {
      country: organization.country,
      today: this.clock.now().toISOString().slice(0, 10),
    };

    // First pass finds the phones; the second knows which of them are taken.
    const firstPass = validateRows(sheet.rows, mapping, { ...options, taken: new Set() });
    const phones = firstPass.candidates.map((candidate) => candidate.phone);
    const taken = new Set<string>();
    for (let start = 0; start < phones.length; start += LOOKUP_SIZE) {
      const existing = await tx.member.findMany({
        where: { phone: { in: phones.slice(start, start + LOOKUP_SIZE) } },
        select: { phone: true },
      });
      existing.forEach((member) => taken.add(member.phone));
    }
    return validateRows(sheet.rows, mapping, { ...options, taken });
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

  private async find(tx: TenantTransaction, caller: StaffCaller, id: string): Promise<ImportRow> {
    const row = await tx.memberImport.findFirst({
      where: { id, deletedAt: null },
      include: importInclude,
    });
    // Location-bound staff see only imports into their locations, and their own uploads.
    const visible =
      row &&
      (caller.locationIds === null ||
        (row.homeLocationId
          ? canSeeLocation(caller, row.homeLocationId)
          : row.createdBy === caller.actor.userId));
    if (!row || !visible) {
      throw notFound('Import');
    }
    return row;
  }
}

function toDto(row: ImportRow): MemberImportDto {
  return {
    id: row.id,
    status: row.status,
    fileName: row.fileName,
    headers: row.headers as string[],
    mapping: row.mapping as Partial<Record<ImportField, number>>,
    sampleRows: row.sampleRows as string[][],
    homeLocation: row.homeLocation,
    totalRows: row.totalRows,
    validRows: row.validRows,
    errorCount: row.errorCount,
    errors: row.errors as unknown as ImportRowErrorDto[],
    createdCount: row.createdCount,
    skippedCount: row.skippedCount,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
