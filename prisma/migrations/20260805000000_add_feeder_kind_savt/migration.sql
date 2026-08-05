-- CreateEnum
CREATE TYPE "FeederKind" AS ENUM ('RONDAAN', 'SAVT');

-- AlterTable: existing feeders are all RONDAAN (SAVT feeders start empty and
-- are populated by the SAVT membership sync + backfill).
ALTER TABLE "Feeder" ADD COLUMN     "kind" "FeederKind" NOT NULL DEFAULT 'RONDAAN';
