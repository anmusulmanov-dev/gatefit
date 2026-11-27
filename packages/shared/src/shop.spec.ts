import { averageCost, productCreateSchema, shopSaleSchema } from './shop';

describe('averageCost', () => {
  it('takes the share of the stock value, rounded half up', () => {
    // 90 g of a 5000 g bag that cost 350 000.00.
    expect(averageCost(35_000_000n, 5000, 90)).toBe(630_000n);
    expect(averageCost(100n, 3, 1)).toBe(33n);
    expect(averageCost(200n, 3, 1)).toBe(67n);
  });

  it('gives all of the value for all of the stock, and nothing for none', () => {
    expect(averageCost(100n, 3, 3)).toBe(100n);
    expect(averageCost(100n, 0, 1)).toBe(0n);
    expect(averageCost(100n, 3, 0)).toBe(0n);
  });

  it('handles values beyond what a float holds exactly', () => {
    expect(averageCost(9_007_199_254_740_993n, 2, 1)).toBe(4_503_599_627_370_497n);
  });
});

describe('shop schemas', () => {
  it('needs whole quantities in units', () => {
    expect(
      productCreateSchema.safeParse({
        name: 'Whey',
        baseUnit: 'gram',
        units: [{ name: 'Portion', baseQuantity: 30.5, priceMinor: '100' }],
      }).success,
    ).toBe(false);
    expect(
      shopSaleSchema.safeParse({
        locationId: '019a0000-0000-7000-8000-000000000000',
        lines: [
          {
            productId: '019a0000-0000-7000-8000-000000000001',
            unitId: '019a0000-0000-7000-8000-000000000002',
            quantity: 0,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
