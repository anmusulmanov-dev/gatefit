-- Hand-written: access rules for the platform tables.
--
-- The platform module connects as gatefit_migrator, the owner of every table, so it needs
-- no grants. Everything below is about what the API role (gatefit_app) may see.

-- An organization may read the history of its own plans, nothing more.
ALTER TABLE saas_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas_subscriptions
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
GRANT SELECT ON saas_subscriptions TO gatefit_app;

-- Plans are the public price list: readable by every organization, to learn which
-- modules and limits its own plan carries. Only the platform changes them.
GRANT SELECT ON saas_plans TO gatefit_app;

-- platform_admins and platform_sessions get no grants at all: the API role cannot read
-- or write platform identities, whatever tenant it is acting for.

-- A tenant may read which plan it is on but never assign itself one. UPDATE on
-- organizations was granted for the whole table; narrow it to the columns a tenant owns.
REVOKE UPDATE ON organizations FROM gatefit_app;
GRANT UPDATE (name, locale, updated_at) ON organizations TO gatefit_app;
