-- Hand-written: RLS and privileges for billing. See docs/ADR/0001-multi-tenancy.md and
-- docs/ADR/0009-billing.md.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['idempotency_keys', 'invoice_counters', 'invoices', 'invoice_items',
                           'payments', 'refunds', 'cash_shifts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END;
$$;

-- Payments, refunds and invoice lines are written once and never changed or deleted
-- (CLAUDE.md rule 2). Invoices change status and paid amount; shifts are closed.
GRANT SELECT, INSERT ON payments, refunds, invoice_items TO gatefit_app;
GRANT SELECT, INSERT, UPDATE ON invoices, cash_shifts, invoice_counters, idempotency_keys TO gatefit_app;

-- The hourly debt job needs to know which organizations have invoices that just became
-- overdue before it can enter any of them. Returns organization ids only.
CREATE FUNCTION jobs_organizations_with_overdue_invoices(p_now timestamptz)
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT i.organization_id
    FROM invoices i
    WHERE i.due_at <= p_now
      AND i.overdue_marked_at IS NULL
      AND i.status IN ('open', 'partially_paid')
      AND i.deleted_at IS NULL
  $$;

REVOKE ALL ON FUNCTION jobs_organizations_with_overdue_invoices(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs_organizations_with_overdue_invoices(timestamptz) TO gatefit_app;
