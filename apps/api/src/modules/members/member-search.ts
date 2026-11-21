import type { Prisma } from '../../generated/prisma/client';

/** Most words a search query is split into; more add nothing but cost. */
const MAX_SEARCH_WORDS = 4;

/** Every word must appear in the first name, the last name or the phone. */
export function searchConditions(q: string | undefined): Prisma.MemberWhereInput[] {
  if (!q) {
    return [];
  }
  return q
    .split(/\s+/)
    .slice(0, MAX_SEARCH_WORDS)
    .map((word) => {
      const digits = word.replace(/[^\d]/g, '');
      const anyOf: Prisma.MemberWhereInput[] = [
        { firstName: { contains: word, mode: 'insensitive' } },
        { lastName: { contains: word, mode: 'insensitive' } },
      ];
      if (digits.length > 0) {
        anyOf.push({ phone: { contains: digits } });
      }
      return { OR: anyOf };
    });
}
