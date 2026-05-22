-- Sprint G2: Asset type and checklist template mapping metadata.

-- AlterTable
ALTER TABLE "AssetType" ADD COLUMN     "capabilityId" UUID,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "sortOrder" INTEGER;

-- AlterTable
ALTER TABLE "InspectionTemplate" ADD COLUMN     "capabilityId" UUID,
ADD COLUMN     "mainheadId" UUID,
ADD COLUMN     "operationalDomain" "OperationalDomain";

-- CreateIndex
CREATE INDEX "AssetType_capabilityId_idx" ON "AssetType"("capabilityId");

-- CreateIndex
CREATE INDEX "AssetType_isActive_sortOrder_idx" ON "AssetType"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "InspectionTemplate_tenantId_isActive_idx" ON "InspectionTemplate"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "InspectionTemplate_capabilityId_idx" ON "InspectionTemplate"("capabilityId");

-- CreateIndex
CREATE INDEX "InspectionTemplate_mainheadId_idx" ON "InspectionTemplate"("mainheadId");

-- CreateIndex
CREATE INDEX "InspectionTemplate_operationalDomain_idx" ON "InspectionTemplate"("operationalDomain");

-- AddForeignKey
ALTER TABLE "AssetType" ADD CONSTRAINT "AssetType_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
