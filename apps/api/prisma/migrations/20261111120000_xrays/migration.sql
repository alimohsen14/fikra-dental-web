-- X-ray images added on a treatment (shown in the patient's record too). The image files live in the upload folder.
CREATE TABLE "XRay" (
  "id" UUID NOT NULL,
  "clinicId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "treatmentId" UUID NOT NULL,
  "file" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "note" TEXT,
  "uploadedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "XRay_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "XRay_clinicId_patientId_idx" ON "XRay"("clinicId", "patientId");
CREATE INDEX "XRay_treatmentId_idx" ON "XRay"("treatmentId");

ALTER TABLE "XRay" ADD CONSTRAINT "XRay_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "XRay" ADD CONSTRAINT "XRay_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "XRay" ADD CONSTRAINT "XRay_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "XRay" ADD CONSTRAINT "XRay_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "XRay" ADD CONSTRAINT "xray_size_positive" CHECK ("size" > 0);

ALTER TABLE "XRay" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "XRay" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "XRay" TO fikra_app;
