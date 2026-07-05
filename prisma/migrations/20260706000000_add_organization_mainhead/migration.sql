-- CreateTable
CREATE TABLE "OrganizationMainhead" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "mainheadId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMainhead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationMainhead_organizationId_idx" ON "OrganizationMainhead"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationMainhead_mainheadId_idx" ON "OrganizationMainhead"("mainheadId");

-- CreateIndex
CREATE INDEX "OrganizationMainhead_isActive_idx" ON "OrganizationMainhead"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMainhead_organizationId_mainheadId_key" ON "OrganizationMainhead"("organizationId", "mainheadId");

-- AddForeignKey
ALTER TABLE "OrganizationMainhead" ADD CONSTRAINT "OrganizationMainhead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMainhead" ADD CONSTRAINT "OrganizationMainhead_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
