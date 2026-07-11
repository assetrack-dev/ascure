-- Hierarchical map foundation (docs/PLAN-hierarchical-map.md):
-- structural Region -> Mainhead -> Pencawang, plus a geo index for the points level.
-- NOTE: the data backfill of Substation.mainheadId is a SEPARATE step, run after
-- this migration:  node scripts/backfill-substation-mainhead.cjs --apply

-- AlterTable
ALTER TABLE "Substation" ADD COLUMN     "mainheadId" UUID;

-- CreateIndex
CREATE INDEX "Substation_mainheadId_idx" ON "Substation"("mainheadId");

-- CreateIndex
CREATE INDEX "Asset_latitude_longitude_idx" ON "Asset"("latitude", "longitude");

-- AddForeignKey
ALTER TABLE "Substation" ADD CONSTRAINT "Substation_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
