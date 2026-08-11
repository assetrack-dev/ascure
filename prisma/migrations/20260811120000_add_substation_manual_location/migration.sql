-- The Pencawang's own coordinate (manual office correction). Null = readers
-- keep deriving the position from the latest site-visit check-in GPS.
ALTER TABLE "Substation" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Substation" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Substation" ADD COLUMN "locationSetAt" TIMESTAMP(3);
ALTER TABLE "Substation" ADD COLUMN "locationSetByEmail" TEXT;
