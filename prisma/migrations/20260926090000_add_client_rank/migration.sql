-- CreateEnum
CREATE TYPE "ClientRank" AS ENUM ('ENGINEER', 'TECHNICIAN', 'FOREMAN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "clientRank" "ClientRank";
