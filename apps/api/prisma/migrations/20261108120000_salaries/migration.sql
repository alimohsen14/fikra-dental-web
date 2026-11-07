-- Monthly salaries, advances and their payments (never deleted: voided with a reason).
CREATE TYPE "SalaryPaymentKind" AS ENUM ('SALARY', 'ADVANCE');

ALTER TABLE "User" ADD COLUMN "monthlySalary" INTEGER;
ALTER TABLE "User" ADD CONSTRAINT "user_salary_not_negative" CHECK ("monthlySalary" IS NULL OR "monthlySalary" >= 0);

CREATE TABLE "SalaryEntry" (
  "id" UUID NOT NULL,
  "clinicId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "month" TEXT NOT NULL,
  "baseAmount" INTEGER NOT NULL,
  "adjustment" INTEGER NOT NULL DEFAULT 0,
  "adjustNote" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalaryPayment" (
  "id" UUID NOT NULL,
  "clinicId" UUID NOT NULL,
  "entryId" UUID NOT NULL,
  "kind" "SalaryPaymentKind" NOT NULL,
  "amount" INTEGER NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "note" TEXT,
  "status" "PaymentStatus" NOT NULL DEFAULT 'ACTIVE',
  "voidedAt" TIMESTAMPTZ(3),
  "voidReason" TEXT,
  "voidedByUserId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalaryEntry_clinicId_userId_month_key" ON "SalaryEntry"("clinicId", "userId", "month");
CREATE INDEX "SalaryEntry_clinicId_month_idx" ON "SalaryEntry"("clinicId", "month");
CREATE INDEX "SalaryPayment_clinicId_paidAt_idx" ON "SalaryPayment"("clinicId", "paidAt");
CREATE INDEX "SalaryPayment_entryId_idx" ON "SalaryPayment"("entryId");

ALTER TABLE "SalaryEntry" ADD CONSTRAINT "SalaryEntry_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalaryEntry" ADD CONSTRAINT "SalaryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "SalaryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalaryEntry" ADD CONSTRAINT "salary_entry_net_not_negative" CHECK ("baseAmount" >= 0 AND "baseAmount" + "adjustment" >= 0);
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "salary_payment_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "SalaryEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalaryEntry" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "SalaryEntry" TO fikra_app;

ALTER TABLE "SalaryPayment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalaryPayment" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "SalaryPayment" TO fikra_app;
