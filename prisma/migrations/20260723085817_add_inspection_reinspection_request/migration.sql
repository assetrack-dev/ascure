-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "reinspectionReason" TEXT,
ADD COLUMN     "reinspectionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "reinspectionRequestedById" UUID;
