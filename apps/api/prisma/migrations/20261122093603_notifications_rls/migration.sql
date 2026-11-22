-- Hand-written: RLS and privileges for notifications, and the new notifications.manage
-- permission for existing organizations. See docs/ADR/0001-multi-tenancy.md and
-- docs/ADR/0011-notifications.md.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_templates', 'notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END;
$$;

-- Templates are edited and reset (body null), never deleted; messages only change status.
GRANT SELECT, INSERT, UPDATE ON notification_templates, notifications TO gatefit_app;

-- The reminder job needs to know which organizations have memberships ending soon before
-- it can enter any of them. Returns organization ids only.
CREATE FUNCTION jobs_organizations_with_expiring_memberships(p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT m.organization_id
    FROM memberships m
    WHERE m.ends_at > p_from
      AND m.ends_at <= p_to
      AND m.cancelled_at IS NULL
      AND m.deleted_at IS NULL
  $$;

REVOKE ALL ON FUNCTION jobs_organizations_with_expiring_memberships(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs_organizations_with_expiring_memberships(timestamptz, timestamptz) TO gatefit_app;

-- The new permission joins the standard owner and manager roles of every existing
-- organization (packages/shared/src/permissions.ts); new organizations get it on creation.
INSERT INTO role_permissions (organization_id, role_id, permission, created_at)
SELECT r.organization_id, r.id, 'notifications.manage', now()
FROM roles r
WHERE r.is_system AND r.name IN ('owner', 'manager') AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
