-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "tenantId" UUID;

-- CreateTable
CREATE TABLE "TeamSupervisor" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "supervisorUserId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSupervisor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisitReassignment" (
    "id" UUID NOT NULL,
    "siteVisitId" UUID NOT NULL,
    "fromTeamId" UUID NOT NULL,
    "toTeamId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "reassignedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisitReassignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisitTeamContribution" (
    "id" UUID NOT NULL,
    "siteVisitId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "assetsCompleted" INTEGER NOT NULL,
    "totalAssets" INTEGER NOT NULL,
    "snapshotReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisitTeamContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamSupervisor_teamId_supervisorUserId_key" ON "TeamSupervisor"("teamId", "supervisorUserId");

-- CreateIndex
CREATE INDEX "TeamSupervisor_supervisorUserId_idx" ON "TeamSupervisor"("supervisorUserId");

-- CreateIndex
CREATE INDEX "TeamSupervisor_teamId_idx" ON "TeamSupervisor"("teamId");

-- CreateIndex
CREATE INDEX "SiteVisitReassignment_siteVisitId_idx" ON "SiteVisitReassignment"("siteVisitId");

-- CreateIndex
CREATE INDEX "SiteVisitTeamContribution_siteVisitId_idx" ON "SiteVisitTeamContribution"("siteVisitId");

-- CreateIndex
CREATE INDEX "SiteVisitTeamContribution_teamId_idx" ON "SiteVisitTeamContribution"("teamId");

-- CreateIndex
CREATE INDEX "Organization_tenantId_idx" ON "Organization"("tenantId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSupervisor" ADD CONSTRAINT "TeamSupervisor_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSupervisor" ADD CONSTRAINT "TeamSupervisor_supervisorUserId_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisitReassignment" ADD CONSTRAINT "SiteVisitReassignment_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisitTeamContribution" ADD CONSTRAINT "SiteVisitTeamContribution_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
