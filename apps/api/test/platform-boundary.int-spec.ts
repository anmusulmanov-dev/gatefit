import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const PLATFORM_DIR = join('modules', 'platform') + sep;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === 'generated' ? [] : sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * Guards CLAUDE.md rule 1: the connection that bypasses row-level security may be used
 * only inside the platform module.
 */
describe('Platform connection boundary', () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: relative(SRC, path),
    text: readFileSync(path, 'utf8'),
  }));

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.path.startsWith(PLATFORM_DIR))).toBe(true);
  });

  it('PlatformPrismaService is referenced only inside modules/platform', () => {
    const offenders = files
      .filter((file) => !file.path.startsWith(PLATFORM_DIR))
      .filter((file) => file.text.includes('PlatformPrismaService'))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('DATABASE_ADMIN_URL is read only by the platform connection and the config schema', () => {
    const readers = files
      .filter((file) => file.text.includes('DATABASE_ADMIN_URL'))
      .map((file) => file.path.split(sep).join('/'))
      .sort();
    expect(readers).toEqual(['config/env.ts', 'modules/platform/platform-prisma.service.ts']);
  });
});
