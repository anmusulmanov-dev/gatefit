import type { PrismaClient } from '../src/generated/prisma/client';
import { createAdminClient } from './support/db';

/**
 * Guards CLAUDE.md rule 1 for tables added in the future: a new table either carries
 * organization_id with RLS, or is listed below as deliberately global.
 */
const GLOBAL_TABLES = [
  // Prisma's migration history.
  '_prisma_migrations',
  // Global identity, reached by tenants only through staff (docs/ADR/0001-multi-tenancy.md).
  'users',
  // The price list: one for all organizations, read-only for them.
  'saas_plans',
  // Gatefit's own operators; the API role has no access to these at all.
  'platform_admins',
  'platform_sessions',
];

// The tenant itself: no organization_id column, isolated by its own id.
const TENANT_ROOT_TABLE = 'organizations';

interface TableInfo {
  name: string;
  has_organization_id: boolean;
  rls_enabled: boolean;
  policy_count: number;
}

describe('RLS coverage of the schema', () => {
  let admin: PrismaClient;
  let tables: TableInfo[];

  beforeAll(async () => {
    admin = createAdminClient();
    // Ordinary and partitioned tables; partitions are covered by their parent.
    tables = await admin.$queryRaw<TableInfo[]>`
      SELECT c.relname AS name,
             EXISTS (
               SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
             ) AS has_organization_id,
             c.relrowsecurity AS rls_enabled,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      ORDER BY c.relname`;
  });

  afterAll(async () => {
    await admin.$disconnect();
  });

  it('finds the schema', () => {
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['organizations', 'locations', 'staff', 'audit_logs']),
    );
  });

  it('every table with organization_id has RLS enabled and a policy', () => {
    const unprotected = tables
      .filter((table) => table.has_organization_id)
      .filter((table) => !table.rls_enabled || table.policy_count === 0)
      .map((table) => table.name);
    expect(unprotected).toEqual([]);
  });

  it('the organizations table is protected too', () => {
    const root = tables.find((table) => table.name === TENANT_ROOT_TABLE);
    expect(root).toMatchObject({ rls_enabled: true });
    expect(root?.policy_count).toBeGreaterThan(0);
  });

  it('every table without organization_id is deliberately global', () => {
    const unexpected = tables
      .filter((table) => !table.has_organization_id && table.name !== TENANT_ROOT_TABLE)
      .map((table) => table.name)
      .filter((name) => !GLOBAL_TABLES.includes(name));
    expect(unexpected).toEqual([]);
  });

  it('the API role has no privileges on platform identities', async () => {
    const grants = await admin.$queryRaw<{ table_name: string }[]>`
      SELECT DISTINCT table_name FROM information_schema.role_table_grants
      WHERE grantee = 'gatefit_app' AND table_name IN ('platform_admins', 'platform_sessions')`;
    expect(grants).toEqual([]);
  });

  it('the API role cannot bypass RLS', async () => {
    const [role] = await admin.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean; owned_tables: number }[]
    >`
      SELECT r.rolsuper, r.rolbypassrls,
             (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owned_tables
      FROM pg_roles r WHERE r.rolname = 'gatefit_app'`;
    // A table owner is exempt from RLS, so the API role must own nothing.
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, owned_tables: 0 });
  });
});
