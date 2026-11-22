-- Hand-written: partitions, RLS and privileges for entry control. See
-- docs/ADR/0001-multi-tenancy.md and docs/ADR/0010-access.md.

-- Policies on a partitioned table apply to every query made through it; the API role
-- gets no privilege on the partitions themselves.
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON check_ins
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

-- Entries are written once and never changed or deleted (CLAUDE.md rule 5): leaving is a
-- new row with direction 'out'.
GRANT SELECT, INSERT ON check_ins TO gatefit_app;

-- Anything outside the monthly partitions lands here instead of failing; the daily job
-- keeps months ahead created so it stays empty.
CREATE TABLE check_ins_default PARTITION OF check_ins DEFAULT;

-- Creates the missing monthly partitions from p_from's month to p_until's month. Owned by
-- the migration role, so the API's daily job can call it without being able to create
-- tables itself. Touches no rows and reveals nothing.
CREATE FUNCTION access_ensure_check_in_partitions(p_from date, p_until date)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    month date := date_trunc('month', p_from)::date;
    created integer := 0;
    name text;
  BEGIN
    IF p_until > p_from + interval '2 years' THEN
      RAISE EXCEPTION 'Too many partitions at once';
    END IF;
    WHILE month <= p_until LOOP
      name := format('check_ins_y%sm%s', to_char(month, 'YYYY'), to_char(month, 'MM'));
      IF to_regclass(name) IS NULL THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF check_ins FOR VALUES FROM (%L) TO (%L)',
          name, month::timestamp AT TIME ZONE 'UTC',
          (month + interval '1 month')::timestamp AT TIME ZONE 'UTC');
        created := created + 1;
      END IF;
      month := (month + interval '1 month')::date;
    END LOOP;
    RETURN created;
  END;
  $$;

REVOKE ALL ON FUNCTION access_ensure_check_in_partitions(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access_ensure_check_in_partitions(date, date) TO gatefit_app;

SELECT access_ensure_check_in_partitions(DATE '2026-11-01', DATE '2027-12-01');
