-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activeSessionId" TEXT,
ADD COLUMN     "sessionIp" TEXT,
ADD COLUMN     "sessionStartedAt" TIMESTAMP(3),
ADD COLUMN     "sessionUserAgent" TEXT,
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totpSecret" TEXT;

