-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "externalRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_tenantId_externalRef_key" ON "Inspection"("tenantId", "externalRef");
