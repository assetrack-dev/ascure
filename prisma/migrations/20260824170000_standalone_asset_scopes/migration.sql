-- Standalone operational scopes (PENCAWANG / FEEDER_PILLAR / LINK_BOX /
-- CABLE_BRIDGE): equipment surveys with no Pencawang check-in.
--
-- 1. A STANDALONE SiteVisit has no substation; a STANDALONE Asset belongs to
--    none. Both columns become nullable — every existing SAVR/SAVT row keeps
--    its value, and the write paths still require one for network scopes.
-- 2. Standalone assets escape the per-substation code uniqueness (NULL
--    substationId rows never collide on that key), so they get a
--    server-assigned tenant-wide refCode (PC-0001 / FP-0001 / LB-0001 /
--    CB-0001) — the stable handle for re-inspection — plus an optional
--    externalRef for TNB's printed equipment ID.

ALTER TABLE "SiteVisit" ALTER COLUMN "substationId" DROP NOT NULL;

ALTER TABLE "Asset" ALTER COLUMN "substationId" DROP NOT NULL;

ALTER TABLE "Asset" ADD COLUMN "refCode" TEXT;
ALTER TABLE "Asset" ADD COLUMN "externalRef" TEXT;

CREATE UNIQUE INDEX "Asset_tenantId_refCode_key" ON "Asset"("tenantId", "refCode");
CREATE INDEX "Asset_externalRef_idx" ON "Asset"("externalRef");
