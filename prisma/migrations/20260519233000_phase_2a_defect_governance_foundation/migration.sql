-- Add defect governance metadata without rewriting historical defects.
CREATE TYPE "DefectLifecycleStatus" AS ENUM (
    'DETECTED',
    'UNDER_REVIEW',
    'VERIFIED',
    'REJECTED',
    'ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'VERIFICATION_PENDING',
    'CLOSED'
);

CREATE TYPE "DefectResolutionOutcome" AS ENUM (
    'REPAIRED',
    'EXTERNAL_CONSTRAINT',
    'PARTIAL',
    'DEFERRED',
    'MONITOR_ONLY',
    'ESCALATED'
);

ALTER TABLE "Defect"
ADD COLUMN "lifecycleStatus" "DefectLifecycleStatus",
ADD COLUMN "resolutionOutcome" "DefectResolutionOutcome",
ADD COLUMN "verifiedByUserId" UUID,
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "verificationRemarks" TEXT,
ADD COLUMN "closureVerifiedByUserId" UUID,
ADD COLUMN "closureVerifiedAt" TIMESTAMP(3),
ADD COLUMN "closureRemarks" TEXT;

CREATE INDEX "Defect_lifecycleStatus_idx" ON "Defect"("lifecycleStatus");
CREATE INDEX "Defect_resolutionOutcome_idx" ON "Defect"("resolutionOutcome");
CREATE INDEX "Defect_verifiedByUserId_idx" ON "Defect"("verifiedByUserId");
CREATE INDEX "Defect_closureVerifiedByUserId_idx" ON "Defect"("closureVerifiedByUserId");

ALTER TABLE "Defect"
    ADD CONSTRAINT "Defect_verifiedByUserId_fkey"
    FOREIGN KEY ("verifiedByUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "Defect"
    ADD CONSTRAINT "Defect_closureVerifiedByUserId_fkey"
    FOREIGN KEY ("closureVerifiedByUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
