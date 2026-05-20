-- Sprint A: add operational accountability metadata without rewriting historical defects.
ALTER TYPE "DefectResolutionOutcome" ADD VALUE 'RESOLVED';
ALTER TYPE "DefectResolutionOutcome" ADD VALUE 'TEMPORARY_FIX';
ALTER TYPE "DefectResolutionOutcome" ADD VALUE 'MONITORING_REQUIRED';
ALTER TYPE "DefectResolutionOutcome" ADD VALUE 'DUPLICATE';
ALTER TYPE "DefectResolutionOutcome" ADD VALUE 'FALSE_POSITIVE';

ALTER TYPE "DefectTimelineEventType" ADD VALUE 'DEFECT_VERIFIED';
ALTER TYPE "DefectTimelineEventType" ADD VALUE 'DEFECT_ASSIGNED';
ALTER TYPE "DefectTimelineEventType" ADD VALUE 'MAINTENANCE_STARTED';
ALTER TYPE "DefectTimelineEventType" ADD VALUE 'MAINTENANCE_COMPLETED';
ALTER TYPE "DefectTimelineEventType" ADD VALUE 'CLOSURE_VERIFIED';

ALTER TABLE "Defect"
ADD COLUMN "assignedToUserId" UUID,
ADD COLUMN "assignedToTeamId" UUID,
ADD COLUMN "assignedAt" TIMESTAMP(3),
ADD COLUMN "maintainedByUserId" UUID,
ADD COLUMN "maintainedAt" TIMESTAMP(3),
ADD COLUMN "verificationNotes" TEXT,
ADD COLUMN "maintenanceNotes" TEXT,
ADD COLUMN "closureVerificationNotes" TEXT;

ALTER TABLE "DefectTimelineEntry"
ADD COLUMN "fromLifecycleStatus" "DefectLifecycleStatus",
ADD COLUMN "toLifecycleStatus" "DefectLifecycleStatus";

CREATE INDEX "Defect_assignedToUserId_idx" ON "Defect"("assignedToUserId");
CREATE INDEX "Defect_assignedToTeamId_idx" ON "Defect"("assignedToTeamId");
CREATE INDEX "Defect_assignedAt_idx" ON "Defect"("assignedAt");
CREATE INDEX "Defect_maintainedByUserId_idx" ON "Defect"("maintainedByUserId");
CREATE INDEX "Defect_maintainedAt_idx" ON "Defect"("maintainedAt");

ALTER TABLE "Defect"
    ADD CONSTRAINT "Defect_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "Defect"
    ADD CONSTRAINT "Defect_assignedToTeamId_fkey"
    FOREIGN KEY ("assignedToTeamId")
    REFERENCES "Team"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "Defect"
    ADD CONSTRAINT "Defect_maintainedByUserId_fkey"
    FOREIGN KEY ("maintainedByUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
