import type { Response } from 'express';
import type { ExportTarget } from './member-export.service';

/** Streams a generated file to the browser as a download. */
export function downloadTo(res: Response): ExportTarget {
  return {
    start(fileName, contentType) {
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res;
    },
  };
}
