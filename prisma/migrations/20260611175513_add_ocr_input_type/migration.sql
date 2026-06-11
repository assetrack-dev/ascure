-- AlterEnum
ALTER TYPE "InspectionItemInputType" ADD VALUE 'OCR';

-- AlterTable
ALTER TABLE "InspectionImage" ADD COLUMN     "templateItemId" UUID;

-- CreateIndex
CREATE INDEX "InspectionImage_templateItemId_idx" ON "InspectionImage"("templateItemId");
