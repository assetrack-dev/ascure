-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "firstSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "lastAmendedAt" TIMESTAMP(3),
ADD COLUMN     "lastAmendedById" UUID;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_lastAmendedById_fkey" FOREIGN KEY ("lastAmendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
