-- Cheques clinics pay their subscription with (incoming only). Platform panel only: RLS policy like the other subscription tables, NO GRANT to fikra_app.
ALTER TABLE "SubscriptionPayment" ADD COLUMN "method" "PaymentMethod" NOT NULL DEFAULT 'CASH';

CREATE TABLE "SubscriptionCheque" (
  "id" UUID NOT NULL,
  "clinicId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "status" "ChequeStatus" NOT NULL DEFAULT 'PENDING',
  "amount" INTEGER NOT NULL,
  "dueDate" DATE NOT NULL,
  "chequeNumber" TEXT,
  "bankName" TEXT,
  "accountNumber" TEXT,
  "drawerName" TEXT,
  "drawerPhone" TEXT,
  "notes" TEXT,
  "image" TEXT,
  "imageMime" TEXT,
  "imageSize" INTEGER,
  "cashedAt" TIMESTAMPTZ(3),
  "returnedAt" TIMESTAMPTZ(3),
  "returnReason" TEXT,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SubscriptionCheque_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionCheque_paymentId_key" ON "SubscriptionCheque"("paymentId");
CREATE INDEX "SubscriptionCheque_clinicId_status_dueDate_idx" ON "SubscriptionCheque"("clinicId", "status", "dueDate");
CREATE INDEX "SubscriptionCheque_status_dueDate_idx" ON "SubscriptionCheque"("status", "dueDate");

ALTER TABLE "SubscriptionCheque" ADD CONSTRAINT "SubscriptionCheque_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionCheque" ADD CONSTRAINT "SubscriptionCheque_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SubscriptionPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionCheque" ADD CONSTRAINT "subscription_cheque_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "SubscriptionCheque" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SubscriptionCheque" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
