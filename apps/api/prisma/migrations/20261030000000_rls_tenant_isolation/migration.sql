-- Row Level Security: a second, database-level wall between clinics.
--
-- The API talks to the database with TWO roles:
--   * the owner role (DATABASE_URL): login, tokens, platform panel. Owners bypass RLS.
--   * fikra_app (TENANT_DATABASE_URL): used ONLY for clinic data. It can see/change a row only
--     when the row's clinicId equals the session setting app.clinic_id, which the API sets
--     inside every transaction. With no setting, it sees nothing (fail closed).
--
-- The role is created WITHOUT a password here (never commit passwords). Set it once with:
--   ALTER ROLE fikra_app PASSWORD '...';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fikra_app') THEN
    CREATE ROLE fikra_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO fikra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User', 'ClinicWhatsapp', 'Doctor', 'DoctorWorkingPeriod', 'Patient', 'Appointment',
    'MessageLog', 'TreatmentType', 'Treatment', 'TreatmentTooth', 'Session', 'Payment', 'AuditLog'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO fikra_app '
      'USING ("clinicId" = NULLIF(current_setting(''app.clinic_id'', true), '''')::uuid) '
      'WITH CHECK ("clinicId" = NULLIF(current_setting(''app.clinic_id'', true), '''')::uuid)',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO fikra_app', t);
  END LOOP;
END
$$;

-- Deleting is allowed only where the business rules allow it. Payments, patients, doctors and
-- users are never hard-deleted (void / archive instead), so fikra_app cannot even try.
GRANT DELETE ON "ClinicWhatsapp", "DoctorWorkingPeriod", "Appointment", "MessageLog",
  "TreatmentType", "Treatment", "TreatmentTooth", "Session" TO fikra_app;

-- The audit log is append-only.
REVOKE UPDATE ON "AuditLog" FROM fikra_app;

-- Clinic and RefreshToken are intentionally NOT granted to fikra_app.
