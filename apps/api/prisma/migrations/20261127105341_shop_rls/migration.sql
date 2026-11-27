-- Hand-written: RLS, privileges and rules for the shop. See docs/ADR/0001-multi-tenancy.md
-- and docs/ADR/0013-shop.md.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'product_units', 'stock_levels', 'stock_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END;
$$;

-- Stock movements are written once and never changed or deleted, like payments.
GRANT SELECT, INSERT ON stock_movements TO gatefit_app;
GRANT SELECT, INSERT, UPDATE ON products, product_units, stock_levels TO gatefit_app;

-- A barcode names one live product within an organization.
CREATE UNIQUE INDEX products_organization_id_barcode_key
  ON products (organization_id, barcode)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE products ADD CONSTRAINT products_values_check
  CHECK ((low_stock_threshold IS NULL OR low_stock_threshold >= 0)
     AND (vat_rate_bp IS NULL OR vat_rate_bp BETWEEN 0 AND 10000));
ALTER TABLE product_units ADD CONSTRAINT product_units_values_check
  CHECK (base_quantity > 0 AND (price_minor IS NULL OR price_minor >= 0));
-- Stock never goes below zero, and neither does its cost.
ALTER TABLE stock_levels ADD CONSTRAINT stock_levels_values_check
  CHECK (on_hand >= 0 AND value_minor >= 0);
-- Each kind of movement moves stock its own way.
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_direction_check
  CHECK (
    (kind = 'receipt' AND quantity_delta > 0 AND value_delta_minor >= 0 AND revenue_minor = 0)
    OR (kind = 'sale' AND quantity_delta < 0 AND value_delta_minor <= 0 AND revenue_minor >= 0
        AND invoice_item_id IS NOT NULL)
    OR (kind = 'return' AND quantity_delta > 0 AND value_delta_minor >= 0 AND revenue_minor <= 0
        AND invoice_item_id IS NOT NULL)
    OR (kind = 'write_off' AND quantity_delta < 0 AND value_delta_minor <= 0 AND revenue_minor = 0)
    OR (kind = 'count_adjust' AND quantity_delta <> 0 AND revenue_minor = 0)
  );

-- Returned goods take their price off the invoice: what is owed is total - credited - paid.
ALTER TABLE invoices DROP CONSTRAINT invoices_amounts_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_check
  CHECK (total_minor >= 0 AND paid_minor >= 0 AND credited_minor >= 0
     AND paid_minor + credited_minor <= total_minor);
-- Only a shop sale may be made to someone who is not a member.
ALTER TABLE invoices ADD CONSTRAINT invoices_member_check
  CHECK (member_id IS NOT NULL OR kind = 'shop');

-- What is owed for goods does not make a member a debtor (docs/ADR/0013-shop.md), so the
-- hourly debt job looks at standard invoices only.
CREATE OR REPLACE FUNCTION jobs_organizations_with_overdue_invoices(p_now timestamptz)
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT i.organization_id
    FROM invoices i
    WHERE i.due_at <= p_now
      AND i.overdue_marked_at IS NULL
      AND i.status IN ('open', 'partially_paid')
      AND i.kind = 'standard'
      AND i.member_id IS NOT NULL
      AND i.deleted_at IS NULL
  $$;

-- The shop permissions join the standard roles of every existing organization
-- (packages/shared/src/permissions.ts). New organizations get them with their roles.
INSERT INTO role_permissions (organization_id, role_id, permission, created_at)
SELECT r.organization_id, r.id, p.permission, now()
FROM roles r
JOIN (VALUES
  ('owner', 'shop.sell'), ('owner', 'shop.stock'), ('owner', 'shop.manage'),
  ('owner', 'shop.reports'),
  ('manager', 'shop.sell'), ('manager', 'shop.stock'),
  ('receptionist', 'shop.sell'),
  ('accountant', 'shop.reports')
) AS p (role_name, permission) ON p.role_name = r.name
WHERE r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- The shop comes with every tariff that takes payments (docs/TZ.md section 12: Start and up).
UPDATE saas_plans
SET modules = modules || '["shop"]'::jsonb
WHERE jsonb_typeof(modules) = 'array' AND modules ? 'payments' AND NOT modules ? 'shop';
