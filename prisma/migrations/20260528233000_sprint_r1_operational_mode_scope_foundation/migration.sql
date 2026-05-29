-- Sprint R1: additive operational mode and scope foundation.
CREATE TYPE "OperationMode" AS ENUM ('INSPECTION', 'MAINTENANCE');
CREATE TYPE "OperationalScope" AS ENUM ('SAVR', 'SAVT', 'PENCAWANG', 'FEEDER_PILLAR', 'CABLE_BRIDGE', 'LINK_BOX');
CREATE TYPE "SessionKind" AS ENUM ('PENCENTRIC', 'ROUTE', 'STANDALONE');

ALTER TABLE "AssetType"
  ADD COLUMN "operationalScope" "OperationalScope";

ALTER TABLE "InspectionTemplate"
  ADD COLUMN "operationalScope" "OperationalScope",
  ADD COLUMN "requiresQAQC" BOOLEAN;

ALTER TABLE "SiteVisit"
  ADD COLUMN "operationMode" "OperationMode",
  ADD COLUMN "operationalScope" "OperationalScope",
  ADD COLUMN "sessionKind" "SessionKind",
  ADD COLUMN "fromPencawangId" UUID,
  ADD COLUMN "toPencawangId" UUID,
  ADD COLUMN "requiresQAQC" BOOLEAN,
  ADD COLUMN "reportingGroup" TEXT;

ALTER TABLE "Inspection"
  ADD COLUMN "operationMode" "OperationMode",
  ADD COLUMN "operationalScope" "OperationalScope",
  ADD COLUMN "requiresQAQC" BOOLEAN,
  ADD COLUMN "reportingGroup" TEXT;

CREATE INDEX "AssetType_operationalScope_idx" ON "AssetType"("operationalScope");

CREATE INDEX "InspectionTemplate_operationalScope_idx" ON "InspectionTemplate"("operationalScope");
CREATE INDEX "InspectionTemplate_requiresQAQC_idx" ON "InspectionTemplate"("requiresQAQC");

CREATE INDEX "SiteVisit_operationMode_idx" ON "SiteVisit"("operationMode");
CREATE INDEX "SiteVisit_operationalScope_idx" ON "SiteVisit"("operationalScope");
CREATE INDEX "SiteVisit_sessionKind_idx" ON "SiteVisit"("sessionKind");
CREATE INDEX "SiteVisit_fromPencawangId_idx" ON "SiteVisit"("fromPencawangId");
CREATE INDEX "SiteVisit_toPencawangId_idx" ON "SiteVisit"("toPencawangId");
CREATE INDEX "SiteVisit_requiresQAQC_idx" ON "SiteVisit"("requiresQAQC");
CREATE INDEX "SiteVisit_reportingGroup_idx" ON "SiteVisit"("reportingGroup");

CREATE INDEX "Inspection_operationMode_idx" ON "Inspection"("operationMode");
CREATE INDEX "Inspection_operationalScope_idx" ON "Inspection"("operationalScope");
CREATE INDEX "Inspection_requiresQAQC_idx" ON "Inspection"("requiresQAQC");
CREATE INDEX "Inspection_reportingGroup_idx" ON "Inspection"("reportingGroup");

ALTER TABLE "SiteVisit"
  ADD CONSTRAINT "SiteVisit_fromPencawangId_fkey"
  FOREIGN KEY ("fromPencawangId")
  REFERENCES "Substation"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "SiteVisit"
  ADD CONSTRAINT "SiteVisit_toPencawangId_fkey"
  FOREIGN KEY ("toPencawangId")
  REFERENCES "Substation"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
