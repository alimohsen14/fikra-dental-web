-- The clinic owner accepts the terms of use before using the system; the version and time are kept (the IP and browser go to the audit log).
ALTER TABLE "User" ADD COLUMN "termsAcceptedVersion" TEXT;
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMPTZ(3);
