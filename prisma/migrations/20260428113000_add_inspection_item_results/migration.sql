-- CreateEnum
CREATE TYPE "InspectionItemResultValue" AS ENUM ('PASS', 'FAIL', 'NA');

-- CreateTable
CREATE TABLE "InspectionItemResult" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "checklistItemId" UUID,
    "label" TEXT NOT NULL,
    "result" "InspectionItemResultValue" NOT NULL,
    "remark" TEXT,
    "isDefect" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionItemResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InspectionItemResult_inspectionId_idx" ON "InspectionItemResult"("inspectionId");

-- CreateIndex
CREATE INDEX "InspectionItemResult_checklistItemId_idx" ON "InspectionItemResult"("checklistItemId");

-- AddForeignKey
ALTER TABLE "InspectionItemResult"
    ADD CONSTRAINT "InspectionItemResult_inspectionId_fkey"
    FOREIGN KEY ("inspectionId")
    REFERENCES "Inspection"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
