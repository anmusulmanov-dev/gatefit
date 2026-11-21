-- Hand-written: RLS for members. See docs/ADR/0001-multi-tenancy.md.

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON members
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

-- No DELETE: members are archived (deleted_at), CLAUDE.md rule 10.
GRANT SELECT, INSERT, UPDATE ON members TO gatefit_app;
