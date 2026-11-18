import { currencyDigits, decimalToMinor, formatMinor, minorToDecimal } from './money';

describe('currencyDigits', () => {
  it.each([
    ['UZS', 2],
    ['USD', 2],
    ['JPY', 0],
    ['KWD', 3],
  ])('%s has %i decimals', (currency, digits) => {
    expect(currencyDigits(currency)).toBe(digits);
  });
});

describe('minorToDecimal', () => {
  it.each([
    ['4500000', 2, '45000.00'],
    ['5', 2, '0.05'],
    ['0', 2, '0.00'],
    ['120', 0, '120'],
    ['007', 0, '7'],
    ['1234', 3, '1.234'],
  ])('%s with %i digits -> %s', (minor, digits, expected) => {
    expect(minorToDecimal(minor, digits)).toBe(expected);
  });

  it('keeps amounts beyond what a float holds exactly', () => {
    expect(minorToDecimal('900719925474099312', 2)).toBe('9007199254740993.12');
  });

  it.each(['-5', '1.5', '', 'abc'])('rejects %p', (minor) => {
    expect(() => minorToDecimal(minor, 2)).toThrow();
  });
});

describe('decimalToMinor', () => {
  it.each([
    ['45000', 2, '4500000'],
    ['45 000', 2, '4500000'],
    ['45 000,5', 2, '4500050'],
    ['45000.05', 2, '4500005'],
    ['0.1', 2, '10'],
    ['0', 2, '0'],
    ['120', 0, '120'],
    ['9007199254740993.12', 2, '900719925474099312'],
  ])('%p with %i digits -> %s', (input, digits, expected) => {
    expect(decimalToMinor(input, digits)).toBe(expected);
  });

  it.each([
    ['1.234', 2],
    ['1.5', 0],
    ['-1', 2],
    ['1e5', 2],
    ['', 2],
    ['abc', 2],
    ['1.2.3', 2],
  ])('rejects %p with %i digits', (input, digits) => {
    expect(decimalToMinor(input, digits)).toBeNull();
  });

  it('round-trips with minorToDecimal', () => {
    expect(decimalToMinor(minorToDecimal('123456789', 2), 2)).toBe('123456789');
  });
});

describe('formatMinor', () => {
  // Intl puts a non-breaking space between the code and the number.
  const plain = (text: string) => text.replace(/\s/g, ' ');

  it('formats exactly, with the currency code', () => {
    expect(plain(formatMinor('900719925474099312', 'USD', 'en'))).toBe(
      'USD 9,007,199,254,740,993.12',
    );
  });

  it('shows the currency decimals', () => {
    expect(plain(formatMinor('30000000', 'UZS', 'en'))).toBe('UZS 300,000.00');
  });
});
