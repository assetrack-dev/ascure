-- Sprint R4D: optional operational session context for inspections.
ALTER TABLE "Inspection"
  ADD COLUMN "operationalSessionId" UUID;

CREATE INDEX "Inspection_operationalSessionId_idx" ON "Inspection"("operationalSessionId");

ALTER TABLE "Inspection"
  ADD CONSTRAINT "Inspection_operationalSessionId_fkey"
  FOREIGN KEY ("operationalSessionId")
  REFERENCES "OperationalSession"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
