-- docs/PLAN-maintenance-flow.md §13: a Kejanggalan added during maintenance
-- (not in the survey) is one flagged item result on the pole's survey
-- inspection. Additive: a new enum + nullable/defaulted columns only.
CREATE TYPE "InspectionItemResultSource" AS ENUM ('SURVEY', 'MAINTENANCE_FINDING');

ALTER TABLE "InspectionItemResult"
  ADD COLUMN "source" "InspectionItemResultSource" NOT NULL DEFAULT 'SURVEY',
  ADD COLUMN "createdByUserId" UUID,
  ADD COLUMN "clientRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InspectionItemResult_clientRef_key" ON "InspectionItemResult"("clientRef");

-- CreateIndex
CREATE INDEX "InspectionItemResult_source_idx" ON "InspectionItemResult"("source");

-- AddForeignKey
ALTER TABLE "InspectionItemResult" ADD CONSTRAINT "InspectionItemResult_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
