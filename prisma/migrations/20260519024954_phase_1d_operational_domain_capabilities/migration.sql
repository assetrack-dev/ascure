-- CreateEnum
CREATE TYPE "OperationalDomain" AS ENUM ('SURVEY', 'INSPECTION', 'MAINTENANCE', 'REPAIR', 'AUDIT', 'CIVIL', 'DISTRIBUTION', 'THIRTY_THREE_KV', 'EMERGENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganizationCapabilityType" AS ENUM ('SURVEY', 'INSPECTION', 'MAINTENANCE', 'REPAIR', 'CIVIL', 'DISTRIBUTION', 'THIRTY_THREE_KV', 'EMERGENCY_RESPONSE', 'QA_VALIDATION', 'REPORTING', 'OTHER');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "operationalDomain" "OperationalDomain";

-- AlterTable
ALTER TABLE "SiteVisit" ADD COLUMN     "operationalDomain" "OperationalDomain";

-- AlterTable
ALTER TABLE "WorkPackage" ADD COLUMN     "operationalDomain" "OperationalDomain";

-- CreateTable
CREATE TABLE "OrganizationCapability" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "capability" "OrganizationCapabilityType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationCapability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationCapability_organizationId_idx" ON "OrganizationCapability"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationCapability_capability_idx" ON "OrganizationCapability"("capability");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCapability_organizationId_capability_key" ON "OrganizationCapability"("organizationId", "capability");

-- CreateIndex
CREATE INDEX "Project_operationalDomain_idx" ON "Project"("operationalDomain");

-- CreateIndex
CREATE INDEX "SiteVisit_operationalDomain_idx" ON "SiteVisit"("operationalDomain");

-- CreateIndex
CREATE INDEX "WorkPackage_operationalDomain_idx" ON "WorkPackage"("operationalDomain");

-- AddForeignKey
ALTER TABLE "OrganizationCapability" ADD CONSTRAINT "OrganizationCapability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
