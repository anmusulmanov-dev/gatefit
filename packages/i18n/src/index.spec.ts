import { defaultLocale, errorMessageKey, locales, messages, resolveLocale } from './index';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix];
  }
  return Object.entries(value)
    .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe('translations', () => {
  const reference = keyPaths(messages[defaultLocale]);

  it.each(locales)('%s has exactly the same keys as the default locale', (locale) => {
    expect(keyPaths(messages[locale])).toEqual(reference);
  });

  it.each(locales)('%s has no empty strings', (locale) => {
    const flat = JSON.stringify(messages[locale]);
    expect(flat).not.toContain('""');
  });
});

describe('errorMessageKey', () => {
  const codes = Object.keys(messages[defaultLocale].errors).filter((code) => code !== 'generic');

  it.each(codes)('maps %s to its own message', (code) => {
    expect(errorMessageKey(code)).toBe(`errors.${code}`);
  });

  it('maps an unknown code to the generic message', () => {
    expect(errorMessageKey('SOMETHING_NEW')).toBe('errors.generic');
  });
});

describe('resolveLocale', () => {
  it('keeps a supported locale', () => {
    expect(resolveLocale('ru')).toBe('ru');
  });

  it.each([undefined, '', 'de', 42])('falls back to the default for %p', (value) => {
    expect(resolveLocale(value)).toBe(defaultLocale);
  });
});
