-- Feeder power-origin (north-star §3): a line running from a Feeder Pillar
-- (FP<n>) or a specific outgoing transformer (TX<n>) becomes its OWN Feeder
-- row — `FP1 A`, `FP2 A` and the direct `A` are three lines with independent
-- sequences. Additive: existing rows default to ''/0 = direct lines.
ALTER TABLE "Feeder" ADD COLUMN "originKind" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Feeder" ADD COLUMN "originNumber" INTEGER NOT NULL DEFAULT 0;

-- Widen the line identity. Sentinel ''/0 rather than NULLs so the unique
-- actually enforces (NULLs never collide in Postgres).
DROP INDEX "Feeder_substationId_code_key";
CREATE UNIQUE INDEX "Feeder_substationId_code_originKind_originNumber_key"
  ON "Feeder"("substationId", "code", "originKind", "originNumber");
