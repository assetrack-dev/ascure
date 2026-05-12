CREATE TYPE "DefectSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

ALTER TABLE "InspectionTemplateItem"
ADD COLUMN "severity" "DefectSeverity" NOT NULL DEFAULT 'MEDIUM';

ALTER TABLE "InspectionItemResult"
ADD COLUMN "severity" "DefectSeverity";

ALTER TABLE "Defect"
ADD COLUMN "severity" "DefectSeverity" NOT NULL DEFAULT 'MEDIUM';

UPDATE "InspectionItemResult" AS result
SET "severity" = item."severity"
FROM "InspectionTemplateItem" AS item
WHERE result."checklistItemId" = item."id";

UPDATE "InspectionItemResult"
SET "severity" = 'MEDIUM'::"DefectSeverity"
WHERE "isDefect" = true
  AND "severity" IS NULL;

UPDATE "Defect" AS defect
SET "severity" = COALESCE(result."severity", 'MEDIUM'::"DefectSeverity")
FROM "InspectionItemResult" AS result
WHERE defect."inspectionItemResultId" = result."id";
