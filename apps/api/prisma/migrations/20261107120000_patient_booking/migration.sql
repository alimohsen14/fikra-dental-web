-- Patient self-booking through WhatsApp.
ALTER TABLE "Patient" ADD COLUMN "selfRegistered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN "bookedByPatient" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BookingLink" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BookingLink_tokenHash_key" ON "BookingLink"("tokenHash");
CREATE INDEX "BookingLink_clinicId_phone_createdAt_idx" ON "BookingLink"("clinicId", "phone", "createdAt");
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same isolation as every other clinic table.
ALTER TABLE "BookingLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BookingLink" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "BookingLink" TO fikra_app;
