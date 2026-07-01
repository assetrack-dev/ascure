-- Append-only audit trail for manager/admin hard-deletes (Site Visit or whole
-- Pencawang cascade). Actor identity denormalised; no user FK so the log
-- survives a later user deletion.

-- CreateTable
CREATE TABLE "DeletionLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorUserId" UUID,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "label" TEXT,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletionLog_tenantId_createdAt_idx" ON "DeletionLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "DeletionLog_entityType_entityId_idx" ON "DeletionLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "DeletionLog" ADD CONSTRAINT "DeletionLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
