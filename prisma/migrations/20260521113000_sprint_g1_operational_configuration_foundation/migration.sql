-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "organizationId" UUID,
ADD COLUMN     "branchId" UUID,
ADD COLUMN     "mainheadId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organizationId" UUID,
ADD COLUMN     "branchId" UUID,
ADD COLUMN     "mainheadId" UUID,
ADD COLUMN     "teamId" UUID;

-- CreateTable
CREATE TABLE "Capability" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationCapabilityAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "capabilityId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationCapabilityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchCapability" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "capabilityId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MainheadCapability" (
    "id" UUID NOT NULL,
    "mainheadId" UUID NOT NULL,
    "capabilityId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MainheadCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamCapability" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "capabilityId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCapability" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "capabilityId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCapability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Capability_code_key" ON "Capability"("code");

-- CreateIndex
CREATE INDEX "Capability_isActive_idx" ON "Capability"("isActive");

-- CreateIndex
CREATE INDEX "OrganizationCapabilityAssignment_organizationId_idx" ON "OrganizationCapabilityAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationCapabilityAssignment_capabilityId_idx" ON "OrganizationCapabilityAssignment"("capabilityId");

-- CreateIndex
CREATE INDEX "OrganizationCapabilityAssignment_isActive_idx" ON "OrganizationCapabilityAssignment"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCapabilityAssignment_organizationId_capabilityId_key" ON "OrganizationCapabilityAssignment"("organizationId", "capabilityId");

-- CreateIndex
CREATE INDEX "BranchCapability_branchId_idx" ON "BranchCapability"("branchId");

-- CreateIndex
CREATE INDEX "BranchCapability_capabilityId_idx" ON "BranchCapability"("capabilityId");

-- CreateIndex
CREATE INDEX "BranchCapability_isActive_idx" ON "BranchCapability"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BranchCapability_branchId_capabilityId_key" ON "BranchCapability"("branchId", "capabilityId");

-- CreateIndex
CREATE INDEX "MainheadCapability_mainheadId_idx" ON "MainheadCapability"("mainheadId");

-- CreateIndex
CREATE INDEX "MainheadCapability_capabilityId_idx" ON "MainheadCapability"("capabilityId");

-- CreateIndex
CREATE INDEX "MainheadCapability_isActive_idx" ON "MainheadCapability"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MainheadCapability_mainheadId_capabilityId_key" ON "MainheadCapability"("mainheadId", "capabilityId");

-- CreateIndex
CREATE INDEX "TeamCapability_teamId_idx" ON "TeamCapability"("teamId");

-- CreateIndex
CREATE INDEX "TeamCapability_capabilityId_idx" ON "TeamCapability"("capabilityId");

-- CreateIndex
CREATE INDEX "TeamCapability_isActive_idx" ON "TeamCapability"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TeamCapability_teamId_capabilityId_key" ON "TeamCapability"("teamId", "capabilityId");

-- CreateIndex
CREATE INDEX "UserCapability_userId_idx" ON "UserCapability"("userId");

-- CreateIndex
CREATE INDEX "UserCapability_capabilityId_idx" ON "UserCapability"("capabilityId");

-- CreateIndex
CREATE INDEX "UserCapability_isActive_idx" ON "UserCapability"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserCapability_userId_capabilityId_key" ON "UserCapability"("userId", "capabilityId");

-- CreateIndex
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");

-- CreateIndex
CREATE INDEX "Team_branchId_idx" ON "Team"("branchId");

-- CreateIndex
CREATE INDEX "Team_mainheadId_idx" ON "Team"("mainheadId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_branchId_idx" ON "User"("branchId");

-- CreateIndex
CREATE INDEX "User_mainheadId_idx" ON "User"("mainheadId");

-- CreateIndex
CREATE INDEX "User_teamId_idx" ON "User"("teamId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCapabilityAssignment" ADD CONSTRAINT "OrganizationCapabilityAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCapabilityAssignment" ADD CONSTRAINT "OrganizationCapabilityAssignment_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchCapability" ADD CONSTRAINT "BranchCapability_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchCapability" ADD CONSTRAINT "BranchCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MainheadCapability" ADD CONSTRAINT "MainheadCapability_mainheadId_fkey" FOREIGN KEY ("mainheadId") REFERENCES "Mainhead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MainheadCapability" ADD CONSTRAINT "MainheadCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCapability" ADD CONSTRAINT "TeamCapability_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCapability" ADD CONSTRAINT "TeamCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCapability" ADD CONSTRAINT "UserCapability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCapability" ADD CONSTRAINT "UserCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed lightweight operational capability catalogue.
INSERT INTO "Capability" ("id", "name", "code", "description", "isActive", "createdAt", "updatedAt") VALUES
('10000000-0000-4000-8000-000000000001', 'SAVR', 'SAVR', 'SAVR asset inspection capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000002', 'SAVT', 'SAVT', 'SAVT asset inspection capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000003', 'Pencawang', 'PENCAWANG', 'Pencawang inspection capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000004', 'Feeder Pillar', 'FEEDER_PILLAR', 'Feeder Pillar inspection capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000005', 'Link Box', 'LINK_BOX', 'Link Box inspection capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000006', 'Cable Bridge', 'CABLE_BRIDGE', 'Cable Bridge inspection capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000007', 'Underground Cable', 'UNDERGROUND_CABLE', 'Underground cable operations capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000008', 'Thermal Inspection', 'THERMAL_INSPECTION', 'Thermal inspection capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000009', 'Maintenance', 'MAINTENANCE', 'Maintenance execution capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000010', 'Survey', 'SURVEY', 'Survey operations capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000011', 'Inspection', 'INSPECTION', 'General inspection capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000012', 'Repair', 'REPAIR', 'Repair operations capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000013', 'Civil', 'CIVIL', 'Civil works capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000014', 'Distribution', 'DISTRIBUTION', 'Distribution network capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000015', '33 KV', 'THIRTY_THREE_KV', '33 KV operations capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000016', 'Emergency Response', 'EMERGENCY_RESPONSE', 'Emergency response capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000017', 'QA Validation', 'QA_VALIDATION', 'QA validation capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000018', 'Reporting', 'REPORTING', 'Operational reporting capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000019', 'Other', 'OTHER', 'Other operational capability.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
