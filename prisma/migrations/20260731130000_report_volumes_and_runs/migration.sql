-- DropIndex
DROP INDEX "SiteVisitReport_siteVisitId_version_key";

-- AlterTable
ALTER TABLE "SiteVisitReport" ADD COLUMN     "part" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "partCount" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SiteVisitReportRun" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "siteVisitId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "totalAssets" INTEGER NOT NULL DEFAULT 0,
    "processedAssets" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedByUserId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SiteVisitReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteVisitReportRun_siteVisitId_idx" ON "SiteVisitReportRun"("siteVisitId");

-- CreateIndex
CREATE INDEX "SiteVisitReportRun_tenantId_idx" ON "SiteVisitReportRun"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteVisitReport_siteVisitId_version_part_key" ON "SiteVisitReport"("siteVisitId", "version", "part");

-- AddForeignKey
ALTER TABLE "SiteVisitReportRun" ADD CONSTRAINT "SiteVisitReportRun_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

