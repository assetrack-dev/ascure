-- docs/PLAN-maintenance-flow.md §12: TNB / Main Contractor may hand a package
-- straight to a crew. Additive + nullable: existing packages keep "company picks".
ALTER TABLE "MaintenancePackage" ADD COLUMN "assignedTeamId" UUID;

-- CreateIndex
CREATE INDEX "MaintenancePackage_assignedTeamId_idx" ON "MaintenancePackage"("assignedTeamId");

-- AddForeignKey
ALTER TABLE "MaintenancePackage" ADD CONSTRAINT "MaintenancePackage_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
