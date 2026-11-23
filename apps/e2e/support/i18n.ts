import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './env.ts';

// The interface speaks Uzbek by default; tests find elements by the same catalogue text.
const messages: unknown = JSON.parse(
  readFileSync(resolve(repoRoot, 'packages/i18n/src/uz.json'), 'utf8'),
);

/**
 * The Uzbek text for a dotted message key, e.g. `t('auth.signIn')`. Simple `{name}`
 * placeholders are filled from `values`; plural forms are not supported.
 */
export function t(key: string, values: Record<string, string | number> = {}): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string') {
    throw new Error(`No message for "${key}" in uz.json`);
  }
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
