-- Sprint R4A: Operational Session asset assignment foundation.
CREATE TABLE "OperationalSessionAsset" (
    "id" UUID NOT NULL,
    "operationalSessionId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" UUID,
    "removedAt" TIMESTAMP(3),
    "removedByUserId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalSessionAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalSessionAsset_operationalSessionId_assetId_key" ON "OperationalSessionAsset"("operationalSessionId", "assetId");
CREATE INDEX "OperationalSessionAsset_operationalSessionId_idx" ON "OperationalSessionAsset"("operationalSessionId");
CREATE INDEX "OperationalSessionAsset_assetId_idx" ON "OperationalSessionAsset"("assetId");
CREATE INDEX "OperationalSessionAsset_removedAt_idx" ON "OperationalSessionAsset"("removedAt");
CREATE INDEX "OperationalSessionAsset_assignedByUserId_idx" ON "OperationalSessionAsset"("assignedByUserId");
CREATE INDEX "OperationalSessionAsset_removedByUserId_idx" ON "OperationalSessionAsset"("removedByUserId");

ALTER TABLE "OperationalSessionAsset"
  ADD CONSTRAINT "OperationalSessionAsset_operationalSessionId_fkey"
  FOREIGN KEY ("operationalSessionId")
  REFERENCES "OperationalSession"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "OperationalSessionAsset"
  ADD CONSTRAINT "OperationalSessionAsset_assetId_fkey"
  FOREIGN KEY ("assetId")
  REFERENCES "Asset"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "OperationalSessionAsset"
  ADD CONSTRAINT "OperationalSessionAsset_assignedByUserId_fkey"
  FOREIGN KEY ("assignedByUserId")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "OperationalSessionAsset"
  ADD CONSTRAINT "OperationalSessionAsset_removedByUserId_fkey"
  FOREIGN KEY ("removedByUserId")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
