-- CreateTable
CREATE TABLE "MaintenancePackage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "siteVisitId" UUID NOT NULL,
    "category" "MaintenanceCategory",
    "maintenanceOrganizationId" UUID NOT NULL,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "assignedByUserId" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenancePackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenancePackage_tenantId_idx" ON "MaintenancePackage"("tenantId");

-- CreateIndex
CREATE INDEX "MaintenancePackage_maintenanceOrganizationId_idx" ON "MaintenancePackage"("maintenanceOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePackage_siteVisitId_category_key" ON "MaintenancePackage"("siteVisitId", "category");

-- AddForeignKey
ALTER TABLE "MaintenancePackage" ADD CONSTRAINT "MaintenancePackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePackage" ADD CONSTRAINT "MaintenancePackage_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePackage" ADD CONSTRAINT "MaintenancePackage_maintenanceOrganizationId_fkey" FOREIGN KEY ("maintenanceOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePackage" ADD CONSTRAINT "MaintenancePackage_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A whole-PE package (category NULL) must be unique per visit. The composite
-- unique above treats NULLs as distinct, so it cannot enforce that on its own.
CREATE UNIQUE INDEX "MaintenancePackage_siteVisitId_whole_key" ON "MaintenancePackage"("siteVisitId") WHERE "category" IS NULL;
