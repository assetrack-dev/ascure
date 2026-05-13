-- Extend the defect workflow without rewriting existing defect rows.
ALTER TYPE "DefectStatus" ADD VALUE 'MONITORING';
ALTER TYPE "DefectStatus" ADD VALUE 'RESOLVED';

-- CreateEnum
CREATE TYPE "DefectTimelineEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'COMMENT');

-- CreateTable
CREATE TABLE "DefectTimelineEntry" (
    "id" UUID NOT NULL,
    "defectId" UUID NOT NULL,
    "type" "DefectTimelineEventType" NOT NULL,
    "fromStatus" "DefectStatus",
    "toStatus" "DefectStatus",
    "comment" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefectTimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefectTimelineEntry_defectId_createdAt_idx" ON "DefectTimelineEntry"("defectId", "createdAt");

-- CreateIndex
CREATE INDEX "DefectTimelineEntry_createdByUserId_idx" ON "DefectTimelineEntry"("createdByUserId");

-- AddForeignKey
ALTER TABLE "DefectTimelineEntry"
    ADD CONSTRAINT "DefectTimelineEntry_defectId_fkey"
    FOREIGN KEY ("defectId")
    REFERENCES "Defect"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectTimelineEntry"
    ADD CONSTRAINT "DefectTimelineEntry_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- Seed a created event for existing defects so detail pages have a stable timeline base.
INSERT INTO "DefectTimelineEntry" (
    "id",
    "defectId",
    "type",
    "toStatus",
    "comment",
    "createdAt"
)
SELECT
    (
        substr(md5('defect-created-' || "id"::text), 1, 8) || '-' ||
        substr(md5('defect-created-' || "id"::text), 9, 4) || '-' ||
        substr(md5('defect-created-' || "id"::text), 13, 4) || '-' ||
        substr(md5('defect-created-' || "id"::text), 17, 4) || '-' ||
        substr(md5('defect-created-' || "id"::text), 21, 12)
    )::uuid,
    "id",
    'CREATED'::"DefectTimelineEventType",
    "status",
    'Defect opened from failed inspection item.',
    "createdAt"
FROM "Defect";
