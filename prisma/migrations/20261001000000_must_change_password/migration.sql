-- An account created with a password somebody else chose must set its own
-- before it can be used. Invites now hand the inviter a generated password to
-- pass on, which is only safe if it stops working the moment it is used.
--
-- Existing accounts are left false: they chose their own passwords, and forcing
-- a change on everyone would be a surprise with no security benefit.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
