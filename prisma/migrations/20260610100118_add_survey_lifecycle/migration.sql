-- CreateEnum
CREATE TYPE "SurveyLifecycleStatus" AS ENUM ('DALAM_RONDAAN', 'RONDAAN_SELESAI', 'PERLU_PINDAAN', 'LAPORAN_SELESAI', 'ARKIB');

-- AlterTable
ALTER TABLE "SiteVisit" ADD COLUMN     "amendmentRemark" TEXT,
ADD COLUMN     "amendmentRequestedAt" TIMESTAMP(3),
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "laporanSelesaiAt" TIMESTAMP(3),
ADD COLUMN     "lifecycleStatus" "SurveyLifecycleStatus",
ADD COLUMN     "rondaanSelesaiAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SiteVisitLifecycleEvent" (
    "id" UUID NOT NULL,
    "siteVisitId" UUID NOT NULL,
    "fromStatus" "SurveyLifecycleStatus",
    "toStatus" "SurveyLifecycleStatus" NOT NULL,
    "remark" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisitLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteVisitLifecycleEvent_siteVisitId_createdAt_idx" ON "SiteVisitLifecycleEvent"("siteVisitId", "createdAt");

-- CreateIndex
CREATE INDEX "SiteVisitLifecycleEvent_createdByUserId_idx" ON "SiteVisitLifecycleEvent"("createdByUserId");

-- CreateIndex
CREATE INDEX "SiteVisit_lifecycleStatus_idx" ON "SiteVisit"("lifecycleStatus");

-- AddForeignKey
ALTER TABLE "SiteVisitLifecycleEvent" ADD CONSTRAINT "SiteVisitLifecycleEvent_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisitLifecycleEvent" ADD CONSTRAINT "SiteVisitLifecycleEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "OrganizationCapabilityAssignment_organizationId_capabilityId_ke" RENAME TO "OrganizationCapabilityAssignment_organizationId_capabilityI_key";
