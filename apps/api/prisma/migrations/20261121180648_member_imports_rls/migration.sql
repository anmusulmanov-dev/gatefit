-- Hand-written: RLS for member_imports. See docs/ADR/0001-multi-tenancy.md.

ALTER TABLE member_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_imports
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

GRANT SELECT, INSERT, UPDATE ON member_imports TO gatefit_app;
