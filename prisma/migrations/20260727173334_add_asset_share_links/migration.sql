-- CreateTable
CREATE TABLE "AssetShareLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AssetShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetShareLink_token_key" ON "AssetShareLink"("token");

-- CreateIndex
CREATE INDEX "AssetShareLink_tenantId_idx" ON "AssetShareLink"("tenantId");

-- CreateIndex
CREATE INDEX "AssetShareLink_assetId_idx" ON "AssetShareLink"("assetId");

-- CreateIndex
CREATE INDEX "AssetShareLink_expiresAt_idx" ON "AssetShareLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "AssetShareLink" ADD CONSTRAINT "AssetShareLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetShareLink" ADD CONSTRAINT "AssetShareLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetShareLink" ADD CONSTRAINT "AssetShareLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
