-- Two purchasable terms (1 year / 3 years) instead of one env-configured plan,
-- each priced ex-GST with the tax added on top.
--
-- Defaults are supplied so existing rows stay valid, then backfilled: a payment
-- taken before this migration was a single-plan annual purchase whose recorded
-- amount carried no separate tax line, so base = amount and tax = 0. That is
-- what actually happened; inventing an 18% split for those rows would put a tax
-- figure on an invoice that was never charged.
ALTER TABLE "payments"
  ADD COLUMN "planKey"         TEXT    NOT NULL DEFAULT 'ANNUAL',
  ADD COLUMN "baseAmountPaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxPercent"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxAmountPaise"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "periodDays"      INTEGER NOT NULL DEFAULT 365;

UPDATE "payments" SET "baseAmountPaise" = "amountPaise" WHERE "baseAmountPaise" = 0;
