-- Sprint R3A: Operational Session Management backend foundation.
CREATE TYPE "OperationalSessionScope" AS ENUM ('SAVR', 'SAVT', 'PENCAWANG', 'FEEDER_PILLAR', 'LINK_BOX', 'CABLE_BRIDGE');

CREATE TYPE "OperationalSessionStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'QA_REVIEW', 'AMENDMENT_REQUIRED', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "OperationalSession" (
    "id" UUID NOT NULL,
    "sessionNo" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "mainheadId" UUID,
    "assignedCompanyId" UUID NOT NULL,
    "assignedQaUserId" UUID,
    "scope" "OperationalSessionScope" NOT NULL,
    "status" "OperationalSessionStatus" NOT NULL DEFAULT 'ASSIGNED',
    "metadata" JSONB,
    "targetDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalSession_workspaceId_sessionNo_key" ON "OperationalSession"("workspaceId", "sessionNo");
CREATE INDEX "OperationalSession_workspaceId_idx" ON "OperationalSession"("workspaceId");
CREATE INDEX "OperationalSession_organizationId_idx" ON "OperationalSession"("organizationId");
CREATE INDEX "OperationalSession_branchId_idx" ON "OperationalSession"("branchId");
CREATE INDEX "OperationalSession_mainheadId_idx" ON "OperationalSession"("mainheadId");
CREATE INDEX "OperationalSession_assignedCompanyId_idx" ON "OperationalSession"("assignedCompanyId");
CREATE INDEX "OperationalSession_assignedQaUserId_idx" ON "OperationalSession"("assignedQaUserId");
CREATE INDEX "OperationalSession_scope_idx" ON "OperationalSession"("scope");
CREATE INDEX "OperationalSession_status_idx" ON "OperationalSession"("status");
CREATE INDEX "OperationalSession_targetDate_idx" ON "OperationalSession"("targetDate");
CREATE INDEX "OperationalSession_dueDate_idx" ON "OperationalSession"("dueDate");
CREATE INDEX "OperationalSession_createdAt_idx" ON "OperationalSession"("createdAt");

ALTER TABLE "OperationalSession"
  ADD CONSTRAINT "OperationalSession_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "Tenant"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "OperationalSession"
  ADD CONSTRAINT "OperationalSession_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "OperationalSession"
  ADD CONSTRAINT "OperationalSession_branchId_fkey"
  FOREIGN KEY ("branchId")
  REFERENCES "Branch"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "OperationalSession"
  ADD CONSTRAINT "OperationalSession_mainheadId_fkey"
  FOREIGN KEY ("mainheadId")
  REFERENCES "Mainhead"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "OperationalSession"
  ADD CONSTRAINT "OperationalSession_assignedCompanyId_fkey"
  FOREIGN KEY ("assignedCompanyId")
  REFERENCES "Organization"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "OperationalSession"
  ADD CONSTRAINT "OperationalSession_assignedQaUserId_fkey"
  FOREIGN KEY ("assignedQaUserId")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
