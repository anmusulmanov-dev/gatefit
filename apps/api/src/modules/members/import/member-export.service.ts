import type { Writable } from 'node:stream';
import { messages, resolveLocale } from '@gatefit/i18n';
import { EXPORT_FIELDS, type ExportField, type MemberExportQuery } from '@gatefit/shared';
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../../../common/audit/audit.service';
import { Clock } from '../../../common/clock/clock';
import type { StaffCaller } from '../../../common/http/staff-request';
import type { TenantTransaction } from '../../../common/prisma/prisma.service';
import { memberInclude, type MemberRow, MembersService } from '../members.service';

/** Rows read per query while exporting. */
const BATCH_SIZE = 1000;

export interface ExportTarget {
  /** Called once, before the first byte. */
  start(fileName: string, contentType: string): Writable;
}

/**
 * Members as a spreadsheet (docs/TZ.md F-1.4). Columns are named in the organization's
 * language and match the import, so an exported file can be imported elsewhere as is.
 */
@Injectable()
export class MemberExportService {
  constructor(
    private readonly members: MembersService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async export(
    tx: TenantTransaction,
    caller: StaffCaller,
    query: MemberExportQuery,
    target: ExportTarget,
  ): Promise<void> {
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: caller.organizationId },
      select: { locale: true },
    });
    const text = messages[resolveLocale(organization.locale)].memberFile;
    const header = EXPORT_FIELDS.map((field) => text.columns[field]);
    const cells = (row: MemberRow): Record<ExportField, string> => ({
      lastName: row.lastName,
      firstName: row.firstName,
      phone: row.phone,
      birthDate: row.birthDate?.toISOString().slice(0, 10) ?? '',
      gender: row.gender ? text.gender[row.gender] : '',
      status: text.status[row.status],
      homeLocation: row.homeLocation.name,
      source: row.source && isSource(row.source, text.source) ? text.source[row.source] : '',
      notes: row.notes ?? '',
      emergencyContactName: row.emergencyContactName ?? '',
      emergencyContactPhone: row.emergencyContactPhone ?? '',
      createdAt: row.createdAt.toISOString().slice(0, 10),
    });

    const date = this.clock.now().toISOString().slice(0, 10);
    const where = this.members.filterWhere(caller, query);
    let count = 0;
    const eachBatch = async (write: (values: string[]) => void) => {
      let cursor: string | undefined;
      for (;;) {
        const rows: MemberRow[] = await tx.member.findMany({
          where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          include: memberInclude,
        });
        for (const row of rows) {
          const values = cells(row);
          write(EXPORT_FIELDS.map((field) => values[field]));
        }
        count += rows.length;
        cursor = rows.at(-1)?.id;
        if (rows.length < BATCH_SIZE) {
          return;
        }
      }
    };

    if (query.format === 'csv') {
      const out = target.start(`members-${date}.csv`, 'text/csv; charset=utf-8');
      // The byte order mark makes Excel read the file as UTF-8.
      out.write(`\uFEFF${toCsvLine(header)}`);
      await eachBatch((values) => {
        out.write(toCsvLine(values));
      });
      await new Promise<void>((resolve) => out.end(resolve));
    } else {
      const out = target.start(
        `members-${date}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out });
      const sheet = workbook.addWorksheet('Members');
      sheet.addRow(header).commit();
      // Plain strings: Excel must not turn phones into numbers or names into formulas.
      await eachBatch((values) => {
        sheet.addRow(values).commit();
      });
      sheet.commit();
      await workbook.commit();
    }

    const { format, ...filter } = query;
    await this.audit.record(tx, caller.organizationId, caller.actor, {
      action: 'member.export',
      entity: 'member',
      after: { format, count, filter },
    });
  }

  /** An empty file with the import columns, in the organization's language. */
  async template(tx: TenantTransaction, caller: StaffCaller, target: ExportTarget): Promise<void> {
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: caller.organizationId },
      select: { locale: true },
    });
    const columns = messages[resolveLocale(organization.locale)].memberFile.columns;
    const out = target.start(
      'members-template.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out });
    const sheet = workbook.addWorksheet('Members');
    sheet.addRow(TEMPLATE_FIELDS.map((field) => columns[field])).commit();
    sheet.commit();
    await workbook.commit();
  }
}

const TEMPLATE_FIELDS = [
  'lastName',
  'firstName',
  'phone',
  'birthDate',
  'gender',
  'notes',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

function isSource<T extends object>(value: string, labels: T): value is Extract<keyof T, string> {
  return value in labels;
}

/** One CSV line. Cells that a spreadsheet would run as a formula are defused. */
export function toCsvLine(values: string[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

function csvCell(value: string): string {
  const defused = /^[=+\-@\t\r]/.test(value) && !/^\+\d+$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}
