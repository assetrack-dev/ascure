-- Stable, human-readable Pencawang reference code (<Mainhead.code><NNNN>, e.g. KTN0001).
-- Additive + nullable: safe on a live table. The codes themselves are assigned
-- lazily/idempotently by reports.service.ensurePencawangRefCodes (not here), so no
-- data backfill runs in this migration.
ALTER TABLE "Substation" ADD COLUMN "refCode" TEXT;

-- Per-tenant uniqueness (matches @@unique([tenantId, code]) + the per-tenant
-- numbering in reports.service). Postgres treats NULLs as distinct, so many
-- uncoded rows per tenant are fine.
CREATE UNIQUE INDEX "Substation_tenantId_refCode_key" ON "Substation"("tenantId", "refCode");
