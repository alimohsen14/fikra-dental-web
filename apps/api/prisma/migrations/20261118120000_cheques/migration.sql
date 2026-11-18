-- Cheques: a new payment method and a table that follows each cheque (pending, cashed, returned).
ALTER TYPE "PaymentMethod" ADD VALUE 'CHEQUE';

CREATE TYPE "ChequeDirection" AS ENUM ('INCOMING', 'OUTGOING');
CREATE TYPE "ChequeStatus" AS ENUM ('PENDING', 'CASHED', 'RETURNED', 'ENDORSED', 'CANCELLED');

CREATE TABLE "Cheque" (
  "id" UUID NOT NULL,
  "clinicId" UUID NOT NULL,
  "direction" "ChequeDirection" NOT NULL DEFAULT 'INCOMING',
  "status" "ChequeStatus" NOT NULL DEFAULT 'PENDING',
  "amount" INTEGER,
  "dueDate" DATE,
  "chequeNumber" TEXT,
  "bankName" TEXT,
  "accountNumber" TEXT,
  "drawerName" TEXT,
  "drawerPhone" TEXT,
  "notes" TEXT,
  "image" TEXT,
  "imageMime" TEXT,
  "imageSize" INTEGER,
  "patientId" UUID,
  "treatmentId" UUID,
  "paymentId" UUID,
  "cashedAt" TIMESTAMPTZ(3),
  "returnedAt" TIMESTAMPTZ(3),
  "returnReason" TEXT,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cheque_paymentId_key" ON "Cheque"("paymentId");
CREATE INDEX "Cheque_clinicId_status_dueDate_idx" ON "Cheque"("clinicId", "status", "dueDate");
CREATE INDEX "Cheque_clinicId_patientId_idx" ON "Cheque"("clinicId", "patientId");
CREATE INDEX "Cheque_treatmentId_idx" ON "Cheque"("treatmentId");

ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cheque" ADD CONSTRAINT "cheque_amount_positive" CHECK ("amount" IS NULL OR "amount" > 0);

ALTER TABLE "Cheque" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Cheque" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cheque" TO fikra_app;
