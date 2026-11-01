-- Every tooth of a treatment gets its own treatment type. Cost and sessions stay on the treatment.
ALTER TABLE "TreatmentTooth" ADD COLUMN "treatmentTypeId" UUID;

UPDATE "TreatmentTooth" tt
SET "treatmentTypeId" = t."treatmentTypeId"
FROM "Treatment" t
WHERE t."id" = tt."treatmentId";

ALTER TABLE "TreatmentTooth" ALTER COLUMN "treatmentTypeId" SET NOT NULL;

ALTER TABLE "TreatmentTooth"
  ADD CONSTRAINT "TreatmentTooth_treatmentTypeId_fkey"
  FOREIGN KEY ("treatmentTypeId") REFERENCES "TreatmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "TreatmentTooth_clinicId_treatmentTypeId_idx" ON "TreatmentTooth"("clinicId", "treatmentTypeId");

ALTER TABLE "Treatment" DROP CONSTRAINT "Treatment_treatmentTypeId_fkey";
ALTER TABLE "Treatment" DROP COLUMN "treatmentTypeId";
