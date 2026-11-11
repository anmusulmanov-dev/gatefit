-- Hand-written: tenant isolation (RLS), privileges of the API role, audit_logs partitions.
-- See docs/ADR/0001-multi-tenancy.md.
--
-- Roles are created outside migrations (infra/postgres/init.sh):
--   gatefit_migrator  runs this file and owns every table, so RLS does not apply to it.
--   gatefit_app       the API. Gets only the privileges granted below and never owns a table.

-- ---------------------------------------------------------------------------
-- Current organization
-- ---------------------------------------------------------------------------

-- Set per transaction by the API: SELECT set_config('app.current_org', '<uuid>', true).
-- Returns NULL when unset, so every policy below matches no rows (fails closed).
CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_org', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- audit_logs partitions
-- ---------------------------------------------------------------------------

-- Creates the partition holding the given month, if it does not exist yet.
CREATE FUNCTION ensure_audit_logs_partition(month date) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  first_day date := date_trunc('month', month)::date;
  next_month date := (first_day + interval '1 month')::date;
  partition_name text := 'audit_logs_' || to_char(first_day, '"y"YYYY"m"MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
    partition_name, first_day, next_month
  );
END;
$$;

-- The current month and the next 12. A scheduled job keeps creating them ahead of time.
DO $$
BEGIN
  FOR i IN 0..12 LOOP
    PERFORM ensure_audit_logs_partition((date_trunc('month', now()) + make_interval(months => i))::date);
  END LOOP;
END;
$$;

-- Safety net: an insert never fails because a month is missing.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- The organization row itself: a tenant sees and edits only its own.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = app_current_org())
  WITH CHECK (id = app_current_org());

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON locations
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE staff_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_locations
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

-- Policies on the partitioned parent apply to every query that goes through it. The API
-- role has no privileges on the partitions themselves, so they cannot be read directly.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consents
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

-- users is global identity (no organization_id), so it has no RLS.

-- ---------------------------------------------------------------------------
-- Privileges of the API role
-- ---------------------------------------------------------------------------
-- Granted table by table on purpose: a new table is unreachable until a migration decides
-- what the API may do with it.
--   No DELETE on business tables: rows are soft-deleted (deleted_at). Hard deletes belong
--   to the GDPR erasure flow, which runs through the platform connection.
--   No INSERT on organizations: tenants are created by the platform module.
--   audit_logs and consents are append-only: no UPDATE, no DELETE.

GRANT USAGE ON SCHEMA public TO gatefit_app;

GRANT SELECT, UPDATE ON organizations TO gatefit_app;
GRANT SELECT, INSERT, UPDATE ON locations, roles, staff, users TO gatefit_app;
-- Pure link rows carry no history: they are added and removed, never edited.
GRANT SELECT, INSERT, DELETE ON role_permissions, staff_locations TO gatefit_app;
GRANT SELECT, INSERT ON audit_logs, consents TO gatefit_app;
