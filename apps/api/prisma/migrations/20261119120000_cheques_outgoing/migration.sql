-- Outgoing cheques (written by the clinic to pay a bill) and incoming cheques handed on to pay a bill.
ALTER TABLE "Cheque" ADD COLUMN "expensePaymentId" UUID;
ALTER TABLE "Cheque" ADD COLUMN "endorsedAt" TIMESTAMPTZ(3);
CREATE INDEX "Cheque_expensePaymentId_idx" ON "Cheque"("expensePaymentId");
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_expensePaymentId_fkey" FOREIGN KEY ("expensePaymentId") REFERENCES "ExpensePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
