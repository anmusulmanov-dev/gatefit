-- Hand-written: RLS for membership_imports. See docs/ADR/0001-multi-tenancy.md.

ALTER TABLE membership_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON membership_imports
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

GRANT SELECT, INSERT, UPDATE ON membership_imports TO gatefit_app;

-- A row is written once; both are set together or not at all.
ALTER TABLE memberships ADD CONSTRAINT memberships_import_check
  CHECK ((import_id IS NULL) = (import_row IS NULL));
ALTER TABLE membership_imports ADD CONSTRAINT membership_imports_counts_check
  CHECK (total_rows >= 0 AND error_count >= 0 AND (debt_minor IS NULL OR debt_minor >= 0));
