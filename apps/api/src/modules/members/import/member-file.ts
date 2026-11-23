import ExcelJS from 'exceljs';

/** A spreadsheet reduced to text: the first row is the header. */
export interface SheetData {
  headers: string[];
  rows: string[][];
}

export type SheetFormat = 'xlsx' | 'csv';

export class UnreadableFileError extends Error {}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** XLSX files are zip archives; anything else is read as CSV text. */
export function detectFormat(buffer: Buffer): SheetFormat {
  return buffer.subarray(0, 4).equals(ZIP_MAGIC) ? 'xlsx' : 'csv';
}

/** Reads the first worksheet of an XLSX file or a CSV file. Empty rows are dropped. */
export async function readSheet(buffer: Buffer): Promise<SheetData> {
  const table = detectFormat(buffer) === 'xlsx' ? await readXlsx(buffer) : readCsv(buffer);
  const nonEmpty = table.filter((row) => row.some((cell) => cell.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  if (headers.length === 0) {
    throw new UnreadableFileError('The file has no header row');
  }
  return { headers: headers.map((header) => header.trim()), rows };
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new UnreadableFileError('Not a readable XLSX file');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return [];
  }
  const table: (string[] | undefined)[] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      cells.push(cellText(row.getCell(column).value));
    }
    table[rowNumber - 1] = cells;
  });
  // eachRow skips nothing with includeEmpty, but sparse sheets can still leave holes.
  return Array.from(table, (row) => row ?? []);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    // Excel stores dates without a zone; exceljs reads them as UTC midnight.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    // Phones typed as numbers must not turn into 9.98901E+11.
    return Number.isInteger(value) ? BigInt(value).toString() : String(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }
  if ('richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('text' in value && typeof value.text === 'string') {
    return value.text;
  }
  if ('result' in value) {
    return cellText(value.result);
  }
  return '';
}

/**
 * RFC 4180 CSV with the separator guessed from the header line: Excel writes `;` where
 * the decimal separator is a comma (ru, uz locales), `,` elsewhere.
 */
export function readCsv(buffer: Buffer): string[][] {
  let text = buffer.toString('utf8');
  if (text.includes('�')) {
    throw new UnreadableFileError('The file is not UTF-8 text');
  }
  if (text.startsWith('\uFEFF')) {
    text = text.slice(1);
  }
  const separator = guessSeparator(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function guessSeparator(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const outsideQuotes = firstLine.replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((candidate) => ({
    candidate,
    count: outsideQuotes.split(candidate).length - 1,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0] && counts[0].count > 0 ? counts[0].candidate : ',';
}
