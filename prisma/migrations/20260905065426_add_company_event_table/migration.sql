-- CreateTable
CREATE TABLE "company_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_events_companyId_idx" ON "company_events"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "company_events_companyId_eventType_eventDate_key" ON "company_events"("companyId", "eventType", "eventDate");
