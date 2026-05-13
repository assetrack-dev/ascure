-- Extend site visit statuses without removing ACTIVE for existing production clients.
ALTER TYPE "SiteVisitStatus" ADD VALUE IF NOT EXISTS 'OPEN';
ALTER TYPE "SiteVisitStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';

-- Create operational workflow enums.
CREATE TYPE "SiteVisitType" AS ENUM ('DISCOVERY', 'REINSPECTION', 'SPECIAL', 'AUDIT');
CREATE TYPE "SiteVisitValidationStatus" AS ENUM ('PENDING', 'VALIDATED', 'WARNING', 'FAILED');

-- Add nullable operational workflow fields to preserve existing rows and APIs.
ALTER TABLE "SiteVisit"
  ADD COLUMN "validatedByUserId" UUID,
  ADD COLUMN "cycleNumber" INTEGER,
  ADD COLUMN "visitType" "SiteVisitType",
  ADD COLUMN "mainhead" TEXT,
  ADD COLUMN "pencawangCode" TEXT,
  ADD COLUMN "pencawangName" TEXT,
  ADD COLUMN "functionalLocation" TEXT,
  ADD COLUMN "checkInLatitude" DOUBLE PRECISION,
  ADD COLUMN "checkInLongitude" DOUBLE PRECISION,
  ADD COLUMN "checkInAccuracyMeters" DOUBLE PRECISION,
  ADD COLUMN "checkInCapturedAt" TIMESTAMP(3),
  ADD COLUMN "validationStatus" "SiteVisitValidationStatus",
  ADD COLUMN "validatedAt" TIMESTAMP(3),
  ADD COLUMN "validationSummary" TEXT,
  ADD COLUMN "feederId" TEXT,
  ADD COLUMN "feederRouteId" TEXT,
  ADD COLUMN "gisGeometryVersion" TEXT,
  ADD COLUMN "completionNotes" TEXT,
  ADD COLUMN "cancelReason" TEXT;

ALTER TABLE "Asset"
  ADD COLUMN "createdByUserId" UUID;

CREATE TABLE "SiteVisitAsset" (
  "id" UUID NOT NULL,
  "siteVisitId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "addedByUserId" UUID,
  "source" TEXT,
  "notes" TEXT,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SiteVisitAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteVisitAsset_siteVisitId_assetId_key" ON "SiteVisitAsset"("siteVisitId", "assetId");
CREATE INDEX "SiteVisitAsset_assetId_idx" ON "SiteVisitAsset"("assetId");
CREATE INDEX "SiteVisitAsset_addedByUserId_idx" ON "SiteVisitAsset"("addedByUserId");
CREATE INDEX "SiteVisitAsset_siteVisitId_addedAt_idx" ON "SiteVisitAsset"("siteVisitId", "addedAt");

CREATE INDEX "SiteVisit_validatedByUserId_idx" ON "SiteVisit"("validatedByUserId");
CREATE INDEX "SiteVisit_cycleNumber_idx" ON "SiteVisit"("cycleNumber");
CREATE INDEX "SiteVisit_visitType_idx" ON "SiteVisit"("visitType");
CREATE INDEX "SiteVisit_validationStatus_idx" ON "SiteVisit"("validationStatus");
CREATE INDEX "SiteVisit_feederId_idx" ON "SiteVisit"("feederId");
CREATE INDEX "SiteVisit_feederRouteId_idx" ON "SiteVisit"("feederRouteId");
CREATE INDEX "Asset_createdByUserId_idx" ON "Asset"("createdByUserId");

ALTER TABLE "SiteVisit"
  ADD CONSTRAINT "SiteVisit_validatedByUserId_fkey"
  FOREIGN KEY ("validatedByUserId")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "SiteVisitAsset"
  ADD CONSTRAINT "SiteVisitAsset_siteVisitId_fkey"
  FOREIGN KEY ("siteVisitId")
  REFERENCES "SiteVisit"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "SiteVisitAsset"
  ADD CONSTRAINT "SiteVisitAsset_assetId_fkey"
  FOREIGN KEY ("assetId")
  REFERENCES "Asset"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "SiteVisitAsset"
  ADD CONSTRAINT "SiteVisitAsset_addedByUserId_fkey"
  FOREIGN KEY ("addedByUserId")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
