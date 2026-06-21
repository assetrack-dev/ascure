-- AlterEnum
ALTER TYPE "SurveyLifecycleStatus" ADD VALUE 'DISAHKAN_PENGURUS';

-- AlterTable
ALTER TABLE "SiteVisit" ADD COLUMN     "managerApprovedAt" TIMESTAMP(3);
