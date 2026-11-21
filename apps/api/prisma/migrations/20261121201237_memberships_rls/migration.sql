-- Hand-written: RLS for plans, memberships and membership_freezes.
-- See docs/ADR/0001-multi-tenancy.md and docs/ADR/0008-memberships.md.

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plans
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE membership_freezes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON membership_freezes
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

-- No DELETE: plans are withdrawn (is_active), memberships cancelled, freezes cancelled.
GRANT SELECT, INSERT, UPDATE ON plans, memberships, membership_freezes TO gatefit_app;

-- The hourly status job (docs/TZ.md 5.3) needs to know which organizations have work
-- before it can enter any of them. Owned by gatefit_migrator, so it sees past RLS; it
-- returns organization ids only, and the job then works inside each one with RLS on.
CREATE FUNCTION jobs_organizations_with_due_memberships(p_now timestamptz)
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT m.organization_id
    FROM memberships m
    WHERE m.status_changes_at <= p_now AND m.deleted_at IS NULL
  $$;

REVOKE ALL ON FUNCTION jobs_organizations_with_due_memberships(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs_organizations_with_due_memberships(timestamptz) TO gatefit_app;
