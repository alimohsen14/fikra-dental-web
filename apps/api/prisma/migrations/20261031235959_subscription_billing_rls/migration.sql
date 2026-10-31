-- Subscription billing tables hold what clinics owe the platform. Clinic users must never see them.
-- Same tenant_isolation policy as every table with a clinicId (the schema test requires it), but
-- NO GRANT to fikra_app: the restricted role gets "permission denied" before RLS even matters.
-- Only the platform panel (owner role) reads and writes these tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SubscriptionPeriod', 'SubscriptionPayment']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO fikra_app '
      'USING ("clinicId" = NULLIF(current_setting(''app.clinic_id'', true), '''')::uuid) '
      'WITH CHECK ("clinicId" = NULLIF(current_setting(''app.clinic_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;
