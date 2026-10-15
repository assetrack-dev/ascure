-- CreateEnum
CREATE TYPE "AssetChangeSource" AS ENUM ('OFFICE', 'MAINTENANCE');

-- AlterTable
ALTER TABLE "Defect" ADD COLUMN     "evidenceChangedAt" TIMESTAMP(3),
ADD COLUMN     "repairMethodId" UUID,
ADD COLUMN     "repairMethodNote" TEXT;

-- CreateTable
CREATE TABLE "RepairMethod" (
    "id" UUID NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectEvidenceImageArchive" (
    "id" UUID NOT NULL,
    "defectId" UUID NOT NULL,
    "createdByUserId" UUID,
    "evidenceType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "url" TEXT,
    "note" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByUserId" UUID,

    CONSTRAINT "DefectEvidenceImageArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetChangeLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" "AssetChangeSource" NOT NULL,
    "changedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepairMethod_code_key" ON "RepairMethod"("code");

-- CreateIndex
CREATE INDEX "RepairMethod_category_isActive_idx" ON "RepairMethod"("category", "isActive");

-- CreateIndex
CREATE INDEX "DefectEvidenceImageArchive_defectId_idx" ON "DefectEvidenceImageArchive"("defectId");

-- CreateIndex
CREATE INDEX "AssetChangeLog_assetId_field_createdAt_idx" ON "AssetChangeLog"("assetId", "field", "createdAt");

-- AddForeignKey
ALTER TABLE "AssetChangeLog" ADD CONSTRAINT "AssetChangeLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetChangeLog" ADD CONSTRAINT "AssetChangeLog_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_repairMethodId_fkey" FOREIGN KEY ("repairMethodId") REFERENCES "RepairMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Plan §20 (P2): the Rentis types TNB uses (owner, 2026-10-15). Admin can add /
-- rename / retire them later; "Lain-lain" requires the crew's own words.
INSERT INTO "RepairMethod" ("id", "category", "code", "label", "requiresNote", "sortOrder", "isActive", "updatedAt") VALUES
  (gen_random_uuid(), 'RENTIS', 'RENTIS_KAEDAH_LAZIM', 'KAEDAH LAZIM', false, 10, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'RENTIS', 'RENTIS_KAEDAH_ABC', 'KAEDAH A.B.C', false, 20, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'RENTIS', 'RENTIS_ULAN_CREEPERS', 'ULAN/CREEPERS', false, 30, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'RENTIS', 'RENTIS_TEBANG_POKOK', 'TEBANG POKOK', false, 40, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'RENTIS', 'RENTIS_LAIN_LAIN', 'Lain-lain (nyatakan)', true, 90, true, CURRENT_TIMESTAMP);
