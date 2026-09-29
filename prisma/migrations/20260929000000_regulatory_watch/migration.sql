-- CreateEnum
CREATE TYPE "RuleChangeKind" AS ENUM ('DUE_DATE_SHIFT', 'DUE_DATE_OVERRIDE', 'THRESHOLD_CHANGE', 'APPLICABILITY_CHANGE', 'EVIDENCE_CHANGE', 'PENALTY_CHANGE', 'TEXT_UPDATE', 'SUSPENSION', 'WITHDRAWAL', 'NEW_RULE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CODE_CHANGE_REQUIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OverlayStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterEnum
ALTER TYPE "Authority" ADD VALUE 'DPIIT';

-- CreateTable
CREATE TABLE "regulatory_updates" (
    "id" TEXT NOT NULL,
    "authority" "Authority" NOT NULL,
    "referenceNo" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedOn" DATE,
    "documentType" TEXT,
    "fingerprint" TEXT NOT NULL,
    "impactSummary" TEXT,
    "raw" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobRunId" TEXT,

    CONSTRAINT "regulatory_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_change_proposals" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "ruleCode" TEXT,
    "changeKind" "RuleChangeKind" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "citations" JSONB NOT NULL,
    "appliesToNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "overlayId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_change_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_overlays" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "status" "OverlayStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdById" TEXT,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_overlays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_updates_fingerprint_key" ON "regulatory_updates"("fingerprint");

-- CreateIndex
CREATE INDEX "regulatory_updates_authority_publishedOn_idx" ON "regulatory_updates"("authority", "publishedOn");

-- CreateIndex
CREATE INDEX "regulatory_updates_discoveredAt_idx" ON "regulatory_updates"("discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "rule_change_proposals_overlayId_key" ON "rule_change_proposals"("overlayId");

-- CreateIndex
CREATE INDEX "rule_change_proposals_status_createdAt_idx" ON "rule_change_proposals"("status", "createdAt");

-- CreateIndex
CREATE INDEX "rule_change_proposals_ruleCode_idx" ON "rule_change_proposals"("ruleCode");

-- CreateIndex
CREATE INDEX "rule_overlays_ruleCode_status_idx" ON "rule_overlays"("ruleCode", "status");

-- AddForeignKey
ALTER TABLE "rule_change_proposals" ADD CONSTRAINT "rule_change_proposals_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "regulatory_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_change_proposals" ADD CONSTRAINT "rule_change_proposals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_change_proposals" ADD CONSTRAINT "rule_change_proposals_overlayId_fkey" FOREIGN KEY ("overlayId") REFERENCES "rule_overlays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_overlays" ADD CONSTRAINT "rule_overlays_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_overlays" ADD CONSTRAINT "rule_overlays_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

