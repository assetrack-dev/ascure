-- AlterTable
ALTER TABLE "InspectionImage" ADD COLUMN     "accuracyMeters" DOUBLE PRECISION,
ADD COLUMN     "capturedFixAt" TIMESTAMP(3),
ADD COLUMN     "mocked" BOOLEAN;
