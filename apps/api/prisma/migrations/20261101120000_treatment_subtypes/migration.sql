-- Treatment types get one more level: a type can have sub-types (crown -> zirconia, porcelain...).
-- Names are unique per parent. Top-level names (parentId IS NULL) are checked by the API, because
-- PostgreSQL treats NULLs as different inside a normal unique index.
ALTER TABLE "TreatmentType" ADD COLUMN "parentId" UUID;
ALTER TABLE "TreatmentType" ADD CONSTRAINT "TreatmentType_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TreatmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX "TreatmentType_clinicId_name_key";
CREATE UNIQUE INDEX "TreatmentType_clinicId_parentId_name_key" ON "TreatmentType"("clinicId", "parentId", "name");
CREATE INDEX "TreatmentType_clinicId_parentId_idx" ON "TreatmentType"("clinicId", "parentId");
