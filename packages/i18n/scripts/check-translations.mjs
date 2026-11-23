// Checks that the uz, ru and en catalogues are complete (docs/TZ.md acceptance criterion 13):
// the same keys everywhere, no empty texts, the same placeholders as English, and no text
// left in English in another language unless it is listed below as the same on purpose.
// Keys used in code are checked by the TypeScript types of next-intl (pnpm typecheck).
//   node packages/i18n/scripts/check-translations.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOCALES = ['uz', 'ru', 'en'];
const REFERENCE = 'en';

/** Texts that are rightly the same as English: names, codes, words borrowed as they are. */
const SAME_ON_PURPOSE = new Set([
  'common.appName',
  'languages.uz',
  'languages.ru',
  'languages.en',
  'messages.locales.uz',
  'messages.locales.ru',
  'messages.locales.en',
  'modules.crm',
  'memberships.period',
  'billing.sale.sold',
  'permissionAreas.audit',
  'memberFile.source.import',
  'members.import',
]);

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object') {
      flatten(child, path, out);
    } else {
      out.set(path, child);
    }
  }
  return out;
}

/** `{name}` and `{name, plural, ...}` arguments; `#` and plural branches are not arguments. */
function placeholders(text) {
  return [...new Set([...String(text).matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]))]
    .sort()
    .join(',');
}

const catalogues = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    flatten(JSON.parse(readFileSync(resolve(here, `../src/${locale}.json`), 'utf8'))),
  ]),
);

const problems = [];
const reference = catalogues[REFERENCE];
for (const locale of LOCALES) {
  const catalogue = catalogues[locale];
  for (const key of reference.keys()) {
    if (!catalogue.has(key)) {
      problems.push(`${locale}: missing ${key}`);
    }
  }
  for (const [key, text] of catalogue) {
    if (!reference.has(key)) {
      problems.push(`${locale}: ${key} is not in ${REFERENCE}`);
      continue;
    }
    if (typeof text !== 'string' || text.trim() === '') {
      problems.push(`${locale}: ${key} is empty`);
      continue;
    }
    if (placeholders(text) !== placeholders(reference.get(key))) {
      problems.push(
        `${locale}: ${key} has placeholders {${placeholders(text)}}, ${REFERENCE} has {${placeholders(reference.get(key))}}`,
      );
    }
    if (
      locale !== REFERENCE &&
      text === reference.get(key) &&
      /[A-Za-z]{3,}/.test(text) &&
      !SAME_ON_PURPOSE.has(key)
    ) {
      problems.push(`${locale}: ${key} is still in English: "${text}"`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Translations are incomplete (${problems.length}):`);
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}
console.log(`Translations complete: ${reference.size} texts in ${LOCALES.join(', ')}.`);
