-- The text of each WhatsApp message is kept, so the clinic can see exactly what the patient received.
ALTER TABLE "MessageLog" ADD COLUMN "body" TEXT;
