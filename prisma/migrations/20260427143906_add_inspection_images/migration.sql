-- CreateTable
CREATE TABLE "InspectionImage" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InspectionImage_inspectionId_idx" ON "InspectionImage"("inspectionId");

-- CreateIndex
CREATE INDEX "InspectionImage_inspectionId_createdAt_idx" ON "InspectionImage"("inspectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "InspectionImage" ADD CONSTRAINT "InspectionImage_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
