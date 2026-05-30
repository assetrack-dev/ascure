-- ASCURE Governance Sprint G1: separate TNB operational territory from contractor organization structure.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "MainheadAccessRole" AS ENUM ('ENGINEER', 'SENIOR_TECHNICIAN', 'FOREMAN', 'VIEWER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
ALTER TYPE "InspectionTemplateScopeLevel" ADD VALUE IF NOT EXISTS 'OPERATIONAL_REGION';

-- CreateTable
CREATE TABLE "OperationalRegion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "state" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMainheadAccess" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mainheadId" UUID NOT NULL,
    "accessRole" "MainheadAccessRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMainheadAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOperationalRegionAccess" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "operationalRegionId" UUID NOT NULL,
    "accessRole" "MainheadAccessRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOperationalRegionAccess_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Mainhead" ADD COLUMN IF NOT EXISTS "operationalRegionId" UUID;

-- AlterTable
ALTER TABLE "Mainhead" DROP CONSTRAINT IF EXISTS "Mainhead_branchId_fkey";
ALTER TABLE "Mainhead" ALTER COLUMN "branchId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InspectionTemplate" ADD COLUMN IF NOT EXISTS "operationalRegionId" UUID;

-- Replace scoped active template uniqueness with region-aware scoped uniqueness.
DROP INDEX IF EXISTS "InspectionTemplate_active_scope_unique";

-- CreateIndex
CREATE UNIQUE INDEX "OperationalRegion_tenantId_code_key" ON "OperationalRegion"("tenantId", "code");

-- CreateIndex
CREATE INDEX "OperationalRegion_tenantId_idx" ON "OperationalRegion"("tenantId");

-- CreateIndex
CREATE INDEX "OperationalRegion_isActive_idx" ON "OperationalRegion"("isActive");

-- CreateIndex
CREATE INDEX "Mainhead_operationalRegionId_idx" ON "Mainhead"("operationalRegionId");

-- CreateIndex
CREATE INDEX "InspectionTemplate_operationalRegionId_idx" ON "InspectionTemplate"("operationalRegionId");

-- CreateIndex
CREATE INDEX "UserMainheadAccess_userId_idx" ON "UserMainheadAccess"("userId");

-- CreateIndex
CREATE INDEX "UserMainheadAccess_mainheadId_idx" ON "UserMainheadAccess"("mainheadId");

-- CreateIndex
CREATE INDEX "UserMainheadAccess_accessRole_idx" ON "UserMainheadAccess"("accessRole");

-- CreateIndex
CREATE UNIQUE INDEX "UserMainheadAccess_userId_mainheadId_key" ON "UserMainheadAccess"("userId", "mainheadId");

-- CreateIndex
CREATE INDEX "UserOperationalRegionAccess_userId_idx" ON "UserOperationalRegionAccess"("userId");

-- CreateIndex
CREATE INDEX "UserOperationalRegionAccess_operationalRegionId_idx" ON "UserOperationalRegionAccess"("operationalRegionId");

-- CreateIndex
CREATE INDEX "UserOperationalRegionAccess_accessRole_idx" ON "UserOperationalRegionAccess"("accessRole");

-- CreateIndex
CREATE UNIQUE INDEX "UserOperationalRegionAccess_userId_operationalRegionId_key" ON "UserOperationalRegionAccess"("userId", "operationalRegionId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionTemplate_active_scope_unique"
ON "InspectionTemplate" (
  "tenantId",
  "assetTypeId",
  (COALESCE("capabilityId", '00000000-0000-0000-0000-000000000000'::uuid)),
  "scopeLevel",
  (COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'::uuid)),
  (COALESCE("operationalRegionId", '00000000-0000-0000-0000-000000000000'::uuid)),
  (COALESCE("branchId", '00000000-0000-0000-0000-000000000000'::uuid)),
  (COALESCE("mainheadId", '00000000-0000-0000-0000-000000000000'::uuid))
)
WHERE "isActive" = true AND "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "OperationalRegion" ADD CONSTRAINT "OperationalRegion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mainhead" ADD CONSTRAINT "Mainhead_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mainhead" ADD CONSTRAINT "Mainhead_operationalRegionId_fkey" FOREIGN KEY ("operationalRegionId") REFERENCES "OperationalRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_operationalRegionId_fkey" FOREIGN KEY ("operationalRegionId") REFERENCES "OperationalRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMainheadAccess" ADD CONSTRAINT "UserMainheadAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMainheadAccess" ADD CONSTRAINT "UserMainheadAccess_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOperationalRegionAccess" ADD CONSTRAINT "UserOperationalRegionAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOperationalRegionAccess" ADD CONSTRAINT "UserOperationalRegionAccess_operationalRegionId_fkey" FOREIGN KEY ("operationalRegionId") REFERENCES "OperationalRegion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
