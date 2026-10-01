-- docs/PLAN-maintenance-flow.md §12.6: split a Pencawang between crews pole by
-- pole. Additive: a new table only.
CREATE TABLE "MaintenancePoleAssignment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "siteVisitId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "category" "MaintenanceCategory",
    "maintenanceOrganizationId" UUID NOT NULL,
    "assignedTeamId" UUID,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "assignedByUserId" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenancePoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenancePoleAssignment_tenantId_idx" ON "MaintenancePoleAssignment"("tenantId");

-- CreateIndex
CREATE INDEX "MaintenancePoleAssignment_assetId_idx" ON "MaintenancePoleAssignment"("assetId");

-- CreateIndex
CREATE INDEX "MaintenancePoleAssignment_maintenanceOrganizationId_idx" ON "MaintenancePoleAssignment"("maintenanceOrganizationId");

-- CreateIndex
CREATE INDEX "MaintenancePoleAssignment_assignedTeamId_idx" ON "MaintenancePoleAssignment"("assignedTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePoleAssignment_siteVisitId_assetId_category_key" ON "MaintenancePoleAssignment"("siteVisitId", "assetId", "category");

-- AddForeignKey
ALTER TABLE "MaintenancePoleAssignment" ADD CONSTRAINT "MaintenancePoleAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePoleAssignment" ADD CONSTRAINT "MaintenancePoleAssignment_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePoleAssignment" ADD CONSTRAINT "MaintenancePoleAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePoleAssignment" ADD CONSTRAINT "MaintenancePoleAssignment_maintenanceOrganizationId_fkey" FOREIGN KEY ("maintenanceOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePoleAssignment" ADD CONSTRAINT "MaintenancePoleAssignment_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePoleAssignment" ADD CONSTRAINT "MaintenancePoleAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A whole-pole row (category NULL) must be unique per (visit, pole). The
-- composite unique above treats NULLs as distinct, so it cannot enforce that.
CREATE UNIQUE INDEX "MaintenancePoleAssignment_siteVisitId_assetId_whole_key" ON "MaintenancePoleAssignment"("siteVisitId", "assetId") WHERE "category" IS NULL;
