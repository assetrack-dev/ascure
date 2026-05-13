-- Add operational assignment and SLA fields without rewriting historical defects.
ALTER TYPE "DefectTimelineEventType" ADD VALUE 'ASSIGNMENT_CHANGED';
ALTER TYPE "DefectTimelineEventType" ADD VALUE 'DUE_DATE_CHANGED';

ALTER TABLE "Defect"
ADD COLUMN "assignedUserId" UUID,
ADD COLUMN "assignedTeamId" UUID,
ADD COLUMN "dueDate" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3);

UPDATE "Defect"
SET "resolvedAt" = COALESCE("closedAt", "updatedAt")
WHERE "status" IN ('RESOLVED', 'CLOSED')
  AND "resolvedAt" IS NULL;

CREATE INDEX "Defect_assignedUserId_idx" ON "Defect"("assignedUserId");
CREATE INDEX "Defect_assignedTeamId_idx" ON "Defect"("assignedTeamId");
CREATE INDEX "Defect_dueDate_idx" ON "Defect"("dueDate");
CREATE INDEX "Defect_status_dueDate_idx" ON "Defect"("status", "dueDate");

ALTER TABLE "Defect"
    ADD CONSTRAINT "Defect_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "Defect"
    ADD CONSTRAINT "Defect_assignedTeamId_fkey"
    FOREIGN KEY ("assignedTeamId")
    REFERENCES "Team"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
