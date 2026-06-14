-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "operationalScope" "OperationalScope" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisitReport" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "siteVisitId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "compiledByUserId" UUID,
    "compiledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisitReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportTemplate_tenantId_idx" ON "ReportTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "ReportTemplate_tenantId_operationalScope_isActive_idx" ON "ReportTemplate"("tenantId", "operationalScope", "isActive");

-- CreateIndex
CREATE INDEX "SiteVisitReport_tenantId_idx" ON "SiteVisitReport"("tenantId");

-- CreateIndex
CREATE INDEX "SiteVisitReport_siteVisitId_version_idx" ON "SiteVisitReport"("siteVisitId", "version");

-- AddForeignKey
ALTER TABLE "SiteVisitReport" ADD CONSTRAINT "SiteVisitReport_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
