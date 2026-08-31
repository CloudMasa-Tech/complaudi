-- Self-service trial signup.
--
-- `trialEndsAt` is null for every organisation that already exists, so nothing
-- currently in use acquires an expiry.
ALTER TABLE "organizations" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
