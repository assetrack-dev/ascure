-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "mainheadId" UUID;

-- AlterTable
ALTER TABLE "SiteVisit" ADD COLUMN     "mainheadId" UUID;

-- AlterTable
ALTER TABLE "WorkPackage" ADD COLUMN     "mainheadId" UUID;

-- CreateTable
CREATE TABLE "Mainhead" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mainhead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mainhead_branchId_idx" ON "Mainhead"("branchId");

-- CreateIndex
CREATE INDEX "Mainhead_isActive_idx" ON "Mainhead"("isActive");

-- CreateIndex
CREATE INDEX "Project_mainheadId_idx" ON "Project"("mainheadId");

-- CreateIndex
CREATE INDEX "SiteVisit_mainheadId_idx" ON "SiteVisit"("mainheadId");

-- CreateIndex
CREATE INDEX "WorkPackage_mainheadId_idx" ON "WorkPackage"("mainheadId");

-- AddForeignKey
ALTER TABLE "Mainhead" ADD CONSTRAINT "Mainhead_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackage" ADD CONSTRAINT "WorkPackage_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
