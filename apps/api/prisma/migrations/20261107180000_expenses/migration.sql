-- Expenses: categories, suppliers, bills and the payments made on them (owner only, same isolation as every clinic table).
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "supplierId" UUID,
    "description" TEXT,
    "amount" INTEGER NOT NULL,
    "incurredAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "voidedByUserId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ExpensePayment" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
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
    CONSTRAINT "ExpensePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseCategory_clinicId_name_key" ON "ExpenseCategory"("clinicId", "name");
CREATE UNIQUE INDEX "Supplier_clinicId_name_key" ON "Supplier"("clinicId", "name");
CREATE INDEX "Expense_clinicId_incurredAt_idx" ON "Expense"("clinicId", "incurredAt");
CREATE INDEX "Expense_clinicId_supplierId_idx" ON "Expense"("clinicId", "supplierId");
CREATE INDEX "ExpensePayment_clinicId_paidAt_idx" ON "ExpensePayment"("clinicId", "paidAt");
CREATE INDEX "ExpensePayment_expenseId_idx" ON "ExpensePayment"("expenseId");

ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "expense_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "expense_payment_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "ExpenseCategory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExpenseCategory" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExpenseCategory" TO fikra_app;

ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Supplier" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "Supplier" TO fikra_app;

ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Expense" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "Expense" TO fikra_app;

ALTER TABLE "ExpensePayment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExpensePayment" FOR ALL TO fikra_app
  USING ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK ("clinicId" = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExpensePayment" TO fikra_app;
