-- CreateTable
CREATE TABLE "SubscriptionPeriod" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "months" INTEGER,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "price" INTEGER NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "voidedByUserId" UUID,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionPeriod_clinicId_endsAt_idx" ON "SubscriptionPeriod"("clinicId", "endsAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_periodId_idx" ON "SubscriptionPayment"("periodId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_clinicId_paidAt_idx" ON "SubscriptionPayment"("clinicId", "paidAt");

-- AddForeignKey
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "SubscriptionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
