import { searchConditions } from './member-search';

describe('searchConditions', () => {
  it('matches nothing extra without a query', () => {
    expect(searchConditions(undefined)).toEqual([]);
  });

  it('looks for a word in both names, and its digits in the phone', () => {
    expect(searchConditions('Ali')).toEqual([
      {
        OR: [
          { firstName: { contains: 'Ali', mode: 'insensitive' } },
          { lastName: { contains: 'Ali', mode: 'insensitive' } },
        ],
      },
    ]);
    expect(searchConditions('+998(90)')[0]?.OR).toContainEqual({ phone: { contains: '99890' } });
  });

  it('needs every word to match, and ignores words beyond the fourth', () => {
    expect(searchConditions('a  b c d e f')).toHaveLength(4);
  });
});
