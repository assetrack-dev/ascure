-- AlterTable
ALTER TABLE "InspectionItemResult" ADD COLUMN "isEmergency" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Defect" ADD COLUMN "isEmergency" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Defect_isEmergency_idx" ON "Defect"("isEmergency");
