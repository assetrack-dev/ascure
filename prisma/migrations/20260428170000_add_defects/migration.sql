-- CreateEnum
CREATE TYPE "DefectStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

-- CreateTable
CREATE TABLE "Defect" (
    "id" UUID NOT NULL,
    "inspectionItemResultId" UUID NOT NULL,
    "status" "DefectStatus" NOT NULL DEFAULT 'OPEN',
    "actionRemark" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Defect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Defect_inspectionItemResultId_key" ON "Defect"("inspectionItemResultId");

-- AddForeignKey
ALTER TABLE "Defect"
    ADD CONSTRAINT "Defect_inspectionItemResultId_fkey"
    FOREIGN KEY ("inspectionItemResultId")
    REFERENCES "InspectionItemResult"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- Backfill existing failed checklist item results as open defects.
INSERT INTO "Defect" (
    "id",
    "inspectionItemResultId",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    (
        substr(md5("id"::text), 1, 8) || '-' ||
        substr(md5("id"::text), 9, 4) || '-' ||
        substr(md5("id"::text), 13, 4) || '-' ||
        substr(md5("id"::text), 17, 4) || '-' ||
        substr(md5("id"::text), 21, 12)
    )::uuid,
    "id",
    'OPEN'::"DefectStatus",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "InspectionItemResult"
WHERE "isDefect" = true
ON CONFLICT ("inspectionItemResultId") DO NOTHING;
