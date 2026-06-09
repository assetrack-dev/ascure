-- CreateEnum
CREATE TYPE "TieEdgeKind" AS ENUM ('NOP');

-- CreateEnum
CREATE TYPE "SwitchState" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "fedFromAssetId" UUID,
ADD COLUMN     "noTiangLama" TEXT;

-- CreateTable
CREATE TABLE "Feeder" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "substationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feeder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoleFeederMembership" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "feederId" UUID NOT NULL,
    "sequenceIndex" INTEGER NOT NULL,
    "branchSuffix" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoleFeederMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkTieEdge" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fromAssetId" UUID NOT NULL,
    "toAssetId" UUID NOT NULL,
    "kind" "TieEdgeKind" NOT NULL DEFAULT 'NOP',
    "switchState" "SwitchState" NOT NULL DEFAULT 'OPEN',
    "deviceAssetId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkTieEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feeder_tenantId_idx" ON "Feeder"("tenantId");

-- CreateIndex
CREATE INDEX "Feeder_substationId_idx" ON "Feeder"("substationId");

-- CreateIndex
CREATE UNIQUE INDEX "Feeder_substationId_code_key" ON "Feeder"("substationId", "code");

-- CreateIndex
CREATE INDEX "PoleFeederMembership_assetId_idx" ON "PoleFeederMembership"("assetId");

-- CreateIndex
CREATE INDEX "PoleFeederMembership_feederId_idx" ON "PoleFeederMembership"("feederId");

-- CreateIndex
CREATE UNIQUE INDEX "PoleFeederMembership_feederId_sequenceIndex_branchSuffix_key" ON "PoleFeederMembership"("feederId", "sequenceIndex", "branchSuffix");

-- CreateIndex
CREATE UNIQUE INDEX "PoleFeederMembership_assetId_feederId_key" ON "PoleFeederMembership"("assetId", "feederId");

-- CreateIndex
CREATE INDEX "NetworkTieEdge_tenantId_idx" ON "NetworkTieEdge"("tenantId");

-- CreateIndex
CREATE INDEX "NetworkTieEdge_fromAssetId_idx" ON "NetworkTieEdge"("fromAssetId");

-- CreateIndex
CREATE INDEX "NetworkTieEdge_toAssetId_idx" ON "NetworkTieEdge"("toAssetId");

-- CreateIndex
CREATE INDEX "NetworkTieEdge_deviceAssetId_idx" ON "NetworkTieEdge"("deviceAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkTieEdge_fromAssetId_toAssetId_kind_key" ON "NetworkTieEdge"("fromAssetId", "toAssetId", "kind");

-- CreateIndex
CREATE INDEX "Asset_fedFromAssetId_idx" ON "Asset"("fedFromAssetId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_fedFromAssetId_fkey" FOREIGN KEY ("fedFromAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feeder" ADD CONSTRAINT "Feeder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feeder" ADD CONSTRAINT "Feeder_substationId_fkey" FOREIGN KEY ("substationId") REFERENCES "Substation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoleFeederMembership" ADD CONSTRAINT "PoleFeederMembership_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoleFeederMembership" ADD CONSTRAINT "PoleFeederMembership_feederId_fkey" FOREIGN KEY ("feederId") REFERENCES "Feeder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkTieEdge" ADD CONSTRAINT "NetworkTieEdge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkTieEdge" ADD CONSTRAINT "NetworkTieEdge_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkTieEdge" ADD CONSTRAINT "NetworkTieEdge_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkTieEdge" ADD CONSTRAINT "NetworkTieEdge_deviceAssetId_fkey" FOREIGN KEY ("deviceAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
