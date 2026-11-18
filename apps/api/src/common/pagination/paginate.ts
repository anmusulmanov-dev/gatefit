import type { Page, PageQuery } from '@gatefit/shared';

/**
 * Prisma arguments for one page of a list ordered by id. Ids are UUID v7, so this is
 * creation order and stays stable while rows are added. One extra row is fetched to learn
 * whether another page exists.
 */
export function pageArgs(query: PageQuery) {
  return {
    where: query.cursor ? { id: { gt: query.cursor } } : {},
    orderBy: { id: 'asc' as const },
    take: query.limit + 1,
  };
}

export function toPage<Row extends { id: string }, Item>(
  rows: Row[],
  query: PageQuery,
  map: (row: Row) => Item,
): Page<Item> {
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: items.map(map),
    nextCursor: rows.length > query.limit && last ? last.id : null,
  };
}
