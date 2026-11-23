import ExcelJS from 'exceljs';
import { detectFormat, readCsv, readSheet, UnreadableFileError } from './member-file';

describe('member file reading', () => {
  it('reads CSV with quotes, a BOM and either separator', async () => {
    const comma = Buffer.from('﻿Name,Phone\r\n"Karimov, Aziz","+998 90 123 45 67"\r\n\r\n');
    await expect(readSheet(comma)).resolves.toEqual({
      headers: ['Name', 'Phone'],
      rows: [['Karimov, Aziz', '+998 90 123 45 67']],
    });
    expect(readCsv(Buffer.from('a;b\n"say ""hi""";2'))).toEqual([
      ['a', 'b'],
      ['say "hi"', '2'],
    ]);
  });

  it('reads the first sheet of an XLSX file, numbers and dates as text', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Members');
    sheet.addRow(['Name', 'Phone', 'Birth date']);
    sheet.addRow(['Aziz', 998901234567, new Date(Date.UTC(1990, 4, 17))]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(detectFormat(buffer)).toBe('xlsx');
    await expect(readSheet(buffer)).resolves.toEqual({
      headers: ['Name', 'Phone', 'Birth date'],
      rows: [['Aziz', '998901234567', '1990-05-17']],
    });
  });

  it('rejects files it cannot read', async () => {
    await expect(readSheet(Buffer.from([0xff, 0xfe, 0x00, 0x41]))).rejects.toThrow(
      UnreadableFileError,
    );
    await expect(readSheet(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toThrow(
      UnreadableFileError,
    );
    await expect(readSheet(Buffer.from('\n\n'))).rejects.toThrow(UnreadableFileError);
  });
});
