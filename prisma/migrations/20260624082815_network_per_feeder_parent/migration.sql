-- AlterTable
ALTER TABLE "PoleFeederMembership" ADD COLUMN     "fedFromAssetId" UUID;

-- CreateIndex
CREATE INDEX "PoleFeederMembership_fedFromAssetId_idx" ON "PoleFeederMembership"("fedFromAssetId");

-- AddForeignKey
ALTER TABLE "PoleFeederMembership" ADD CONSTRAINT "PoleFeederMembership_fedFromAssetId_fkey" FOREIGN KEY ("fedFromAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
