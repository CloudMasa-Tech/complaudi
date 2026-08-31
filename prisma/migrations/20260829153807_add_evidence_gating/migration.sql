-- CreateEnum
CREATE TYPE "EvidenceLevel" AS ENUM ('REQUIRED', 'ATTEST', 'NONE');

-- AlterTable
ALTER TABLE "compliance_items" ADD COLUMN     "attestationText" TEXT,
ADD COLUMN     "attestedAt" TIMESTAMP(3),
ADD COLUMN     "attestedById" TEXT,
ADD COLUMN     "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'NONE';
