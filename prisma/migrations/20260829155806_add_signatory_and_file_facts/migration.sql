-- AlterTable
ALTER TABLE "compliance_items" ADD COLUMN     "signatoryName" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "detectedType" TEXT,
ADD COLUMN     "hasDigitalSignature" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pdfPages" INTEGER,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signers" TEXT[] DEFAULT ARRAY[]::TEXT[];
