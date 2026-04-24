-- AlterEnum
ALTER TYPE "InspectionItemInputType" ADD VALUE IF NOT EXISTS 'SELECT';

-- AlterEnum
ALTER TYPE "InspectionTemplateStatus" RENAME VALUE 'RETIRED' TO 'ARCHIVED';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPERVISOR';

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InspectionTemplate_one_active_per_assetType_key"
ON "InspectionTemplate"("assetTypeId")
WHERE "isActive" = true;
