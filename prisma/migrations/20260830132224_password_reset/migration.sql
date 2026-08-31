-- Records when a password last changed, so tokens minted before it can be
-- refused. A reset that leaves existing sessions alive is not a reset.
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
