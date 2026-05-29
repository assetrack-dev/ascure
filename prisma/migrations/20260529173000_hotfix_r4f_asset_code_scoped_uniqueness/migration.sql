-- Hotfix R4F: asset codes are unique only inside a Pencawang/substation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "tenantId", "substationId", "code"
      FROM "Asset"
      GROUP BY "tenantId", "substationId", "code"
      HAVING COUNT(*) > 1
    ) scoped_duplicates
  ) THEN
    RAISE EXCEPTION 'Cannot add scoped Asset code uniqueness: duplicate asset codes exist within the same tenant/substation.';
  END IF;
END $$;

DROP INDEX IF EXISTS "Asset_tenantId_code_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_tenantId_substationId_code_key"
  ON "Asset"("tenantId", "substationId", "code");
