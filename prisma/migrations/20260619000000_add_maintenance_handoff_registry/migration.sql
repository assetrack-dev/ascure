-- Maintenance handoff Phase 2/3: the MAINHEAD->maintenance-company registry and
-- the per-defect routing stamp.

-- AlterTable: register a maintenance company per MAINHEAD (defects release to it).
ALTER TABLE "Mainhead" ADD COLUMN "maintenanceOrganizationId" UUID;

-- AlterTable: stamp the maintenance company a defect was routed to on release.
ALTER TABLE "Defect" ADD COLUMN "maintenanceOrganizationId" UUID;

-- CreateIndex
CREATE INDEX "Mainhead_maintenanceOrganizationId_idx" ON "Mainhead"("maintenanceOrganizationId");

-- CreateIndex
CREATE INDEX "Defect_maintenanceOrganizationId_idx" ON "Defect"("maintenanceOrganizationId");

-- AddForeignKey
ALTER TABLE "Mainhead" ADD CONSTRAINT "Mainhead_maintenanceOrganizationId_fkey" FOREIGN KEY ("maintenanceOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_maintenanceOrganizationId_fkey" FOREIGN KEY ("maintenanceOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
