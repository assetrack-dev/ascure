-- ADR 0002 §1: OrganizationType -> { ASCURE, TNB, MAIN_CONTRACTOR, SUBCONTRACTOR, CLIENT }
-- Add MAIN_CONTRACTOR; drop CONSULTANT and OTHER. Postgres cannot DROP enum
-- values in place, so this is a rename-and-swap. Existing orgs of the dropped
-- types are repointed to SUBCONTRACTOR first (preserves mutate ability; pilot
-- is expected to have none — verify with the pre-flight count before deploy).

-- 1. Repoint any rows of the dropped types (safe no-op if there are none).
UPDATE "Organization" SET "type" = 'SUBCONTRACTOR' WHERE "type" IN ('CONSULTANT', 'OTHER');

-- 2. Recreate the enum without the dropped values, swapping the column over.
ALTER TABLE "Organization" ALTER COLUMN "type" DROP DEFAULT;
ALTER TYPE "OrganizationType" RENAME TO "OrganizationType_old";
CREATE TYPE "OrganizationType" AS ENUM ('ASCURE', 'TNB', 'MAIN_CONTRACTOR', 'SUBCONTRACTOR', 'CLIENT');
ALTER TABLE "Organization" ALTER COLUMN "type" TYPE "OrganizationType" USING ("type"::text::"OrganizationType");
DROP TYPE "OrganizationType_old";
