-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('RENTIS', 'CAT_TIANG', 'SELENGGARAAN');

-- AlterTable
ALTER TABLE "Defect" ADD COLUMN     "maintenanceCategory" "MaintenanceCategory";

-- AlterTable
ALTER TABLE "InspectionItemResult" ADD COLUMN     "maintenanceCategory" "MaintenanceCategory";

-- AlterTable
ALTER TABLE "InspectionTemplateItem" ADD COLUMN     "maintenanceCategory" "MaintenanceCategory";
