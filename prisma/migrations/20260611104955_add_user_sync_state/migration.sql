-- AlterTable
ALTER TABLE "User" ADD COLUMN     "syncPendingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncReportedAt" TIMESTAMP(3);
