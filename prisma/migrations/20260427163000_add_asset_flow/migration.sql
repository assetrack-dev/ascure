-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'NOT_FOUND', 'REMOVED', 'DUPLICATE');

-- AlterTable
ALTER TABLE "Asset"
    ADD COLUMN "createdDuringVisitId" UUID,
    ADD COLUMN "latitude" DOUBLE PRECISION,
    ADD COLUMN "longitude" DOUBLE PRECISION,
    ADD COLUMN "metadata" JSONB,
    ALTER COLUMN "name" DROP NOT NULL;

ALTER TABLE "Asset"
    ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Asset"
    ALTER COLUMN "status" TYPE "AssetStatus"
    USING (
      CASE
        WHEN "status" IS NULL THEN 'ACTIVE'::"AssetStatus"
        WHEN UPPER("status") = 'ACTIVE' THEN 'ACTIVE'::"AssetStatus"
        WHEN UPPER("status") = 'INACTIVE' THEN 'INACTIVE'::"AssetStatus"
        WHEN UPPER("status") = 'NOT_FOUND' THEN 'NOT_FOUND'::"AssetStatus"
        WHEN UPPER("status") = 'REMOVED' THEN 'REMOVED'::"AssetStatus"
        WHEN UPPER("status") = 'DUPLICATE' THEN 'DUPLICATE'::"AssetStatus"
        ELSE 'ACTIVE'::"AssetStatus"
      END
    );

ALTER TABLE "Asset"
    ALTER COLUMN "status" SET DEFAULT 'ACTIVE',
    ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "Asset"
    DROP COLUMN "serialNumber";

-- CreateIndex
CREATE INDEX "Asset_createdDuringVisitId_idx" ON "Asset"("createdDuringVisitId");

-- AddForeignKey
ALTER TABLE "Asset"
    ADD CONSTRAINT "Asset_createdDuringVisitId_fkey"
    FOREIGN KEY ("createdDuringVisitId")
    REFERENCES "SiteVisit"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
