-- Sprint F: additive defect maintenance proof images.
CREATE TABLE "DefectEvidenceImage" (
    "id" UUID NOT NULL,
    "defectId" UUID NOT NULL,
    "createdByUserId" UUID,
    "evidenceType" TEXT NOT NULL DEFAULT 'MAINTENANCE_PROOF',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "url" TEXT,
    "note" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectEvidenceImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DefectEvidenceImage_defectId_idx" ON "DefectEvidenceImage"("defectId");
CREATE INDEX "DefectEvidenceImage_createdByUserId_idx" ON "DefectEvidenceImage"("createdByUserId");
CREATE INDEX "DefectEvidenceImage_evidenceType_idx" ON "DefectEvidenceImage"("evidenceType");
CREATE INDEX "DefectEvidenceImage_createdAt_idx" ON "DefectEvidenceImage"("createdAt");

ALTER TABLE "DefectEvidenceImage"
    ADD CONSTRAINT "DefectEvidenceImage_defectId_fkey"
    FOREIGN KEY ("defectId")
    REFERENCES "Defect"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "DefectEvidenceImage"
    ADD CONSTRAINT "DefectEvidenceImage_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
