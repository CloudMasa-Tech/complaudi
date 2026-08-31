-- Registrations an entity holds, shown on the dashboard.
--
-- Every column is nullable, so nothing already onboarded needs backfilling —
-- an entity that holds no DPIIT recognition simply has none on record, which
-- reads as "NA" rather than as a gap in the data.
ALTER TABLE "companies" ADD COLUMN "dpiitRecognitionNumber" TEXT;
ALTER TABLE "companies" ADD COLUMN "dpiitRecognisedOn" DATE;
ALTER TABLE "companies" ADD COLUMN "epfoCode" TEXT;
ALTER TABLE "companies" ADD COLUMN "esicCode" TEXT;

-- The expiry, not the certificate: a DSC is "active" only until this date.
ALTER TABLE "directors" ADD COLUMN "dscExpiresOn" DATE;
