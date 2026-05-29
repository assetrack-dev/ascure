-- Template scope governance for multi-region / branch / MAINHEAD rollout.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "InspectionTemplateScopeLevel" AS ENUM ('GLOBAL', 'ORGANIZATION', 'BRANCH', 'MAINHEAD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "InspectionTemplate"
ADD COLUMN     "scopeLevel" "InspectionTemplateScopeLevel" NOT NULL DEFAULT 'GLOBAL',
ADD COLUMN     "organizationId" UUID,
ADD COLUMN     "branchId" UUID;

-- Existing templates are treated as global/default templates.
UPDATE "InspectionTemplate"
SET "scopeLevel" = 'GLOBAL',
    "organizationId" = NULL,
    "branchId" = NULL,
    "mainheadId" = NULL;

-- Replace legacy global activation/version constraints with scoped governance.
DROP INDEX IF EXISTS "InspectionTemplate_one_active_per_assetType_key";
DROP INDEX IF EXISTS "InspectionTemplate_assetTypeId_version_key";

-- CreateIndex
CREATE INDEX "InspectionTemplate_assetTypeId_version_idx" ON "InspectionTemplate"("assetTypeId", "version");

-- CreateIndex
CREATE INDEX "InspectionTemplate_assetTypeId_capabilityId_scopeLevel_idx" ON "InspectionTemplate"("assetTypeId", "capabilityId", "scopeLevel");

-- CreateIndex
CREATE INDEX "InspectionTemplate_scopeLevel_idx" ON "InspectionTemplate"("scopeLevel");

-- CreateIndex
CREATE INDEX "InspectionTemplate_organizationId_idx" ON "InspectionTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "InspectionTemplate_branchId_idx" ON "InspectionTemplate"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionTemplate_active_scope_unique"
ON "InspectionTemplate" (
  "tenantId",
  "assetTypeId",
  (COALESCE("capabilityId", '00000000-0000-0000-0000-000000000000'::uuid)),
  "scopeLevel",
  (COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'::uuid)),
  (COALESCE("branchId", '00000000-0000-0000-0000-000000000000'::uuid)),
  (COALESCE("mainheadId", '00000000-0000-0000-0000-000000000000'::uuid))
)
WHERE "isActive" = true AND "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
