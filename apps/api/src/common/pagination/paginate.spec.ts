import { pageArgs, toPage } from './paginate';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `id-${index + 1}` }));

describe('pagination', () => {
  it('asks for one row more than the page size', () => {
    expect(pageArgs({ limit: 20 })).toEqual({ where: {}, orderBy: { id: 'asc' }, take: 21 });
  });

  it('continues after the cursor', () => {
    expect(pageArgs({ limit: 20, cursor: 'abc' }).where).toEqual({ id: { gt: 'abc' } });
  });

  it('returns a cursor only when another page exists', () => {
    const full = toPage(rows(3), { limit: 2 }, (row) => row.id);
    expect(full).toEqual({ items: ['id-1', 'id-2'], nextCursor: 'id-2' });

    const last = toPage(rows(2), { limit: 2 }, (row) => row.id);
    expect(last).toEqual({ items: ['id-1', 'id-2'], nextCursor: null });
  });

  it('handles an empty list', () => {
    expect(toPage([], { limit: 2 }, (row) => row)).toEqual({ items: [], nextCursor: null });
  });
});
