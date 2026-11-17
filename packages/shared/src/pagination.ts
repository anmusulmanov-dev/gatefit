import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/** `?cursor=&limit=` accepted by every list endpoint. */
export const pageQuerySchema = z.object({
  /** `nextCursor` of the previous page; omitted for the first page. */
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}
