import {
  AssetStatus,
  PrismaClient,
  InspectionItemInputType,
  InspectionTemplateStatus,
  OrganizationMembershipRole,
  OrganizationType,
  ProjectStatus,
  UserRole,
  WorkPackageStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordSaltRounds = 10;
  const adminPasswordHash = await bcrypt.hash('Admin123!', passwordSaltRounds);
  const managerPasswordHash = await bcrypt.hash('Manager123!', passwordSaltRounds);
  const supervisorPasswordHash = await bcrypt.hash('Supervisor123!', passwordSaltRounds);
  const technicianPasswordHash = await bcrypt.hash('Tech123!', passwordSaltRounds);

  const tenant = await prisma.tenant.upsert({
    where: { code: 'demo-tenant' },
    update: { name: 'Demo Utility Tenant' },
    create: {
      code: 'demo-tenant',
      name: 'Demo Utility Tenant',
    },
  });

  const department = await prisma.department.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: 'OPS',
      },
    },
    update: { name: 'Operations' },
    create: {
      tenantId: tenant.id,
      code: 'OPS',
      name: 'Operations',
    },
  });

  const team = await prisma.team.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: 'TEAM-ALPHA',
      },
    },
    update: {
      name: 'Team Alpha',
      departmentId: department.id,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      departmentId: department.id,
      code: 'TEAM-ALPHA',
      name: 'Team Alpha',
      isActive: true,
    },
  });

  const ascureOrganization = await prisma.organization.upsert({
    where: { code: 'ASCURE' },
    update: {
      name: 'ASCURE',
      type: OrganizationType.ASCURE,
      isActive: true,
    },
    create: {
      code: 'ASCURE',
      name: 'ASCURE',
      type: OrganizationType.ASCURE,
      isActive: true,
    },
  });

  const tnbOrganization = await prisma.organization.upsert({
    where: { code: 'TNB' },
    update: {
      name: 'Tenaga Nasional Berhad',
      type: OrganizationType.TNB,
      isActive: true,
    },
    create: {
      code: 'TNB',
      name: 'Tenaga Nasional Berhad',
      type: OrganizationType.TNB,
      isActive: true,
    },
  });

  const existingBranch = await prisma.branch.findFirst({
    where: {
      organizationId: ascureOrganization.id,
      code: 'ASCURE-OPS',
    },
    select: { id: true },
  });

  const branch = existingBranch
    ? await prisma.branch.update({
        where: { id: existingBranch.id },
        data: {
          name: 'ASCURE Operations',
          region: 'Central',
          isActive: true,
        },
      })
    : await prisma.branch.create({
        data: {
          organizationId: ascureOrganization.id,
          code: 'ASCURE-OPS',
          name: 'ASCURE Operations',
          region: 'Central',
          isActive: true,
        },
      });

  const existingMainhead = await prisma.mainhead.findFirst({
    where: {
      branchId: branch.id,
      code: 'SAVR',
    },
    select: { id: true },
  });

  const mainhead = existingMainhead
    ? await prisma.mainhead.update({
        where: { id: existingMainhead.id },
        data: {
          name: 'SAVR MAINHEAD',
          description: 'Default MAINHEAD for SAVR field inspection operations.',
          isActive: true,
        },
      })
    : await prisma.mainhead.create({
        data: {
          branchId: branch.id,
          code: 'SAVR',
          name: 'SAVR MAINHEAD',
          description: 'Default MAINHEAD for SAVR field inspection operations.',
          isActive: true,
        },
      });

  const project = await prisma.project.upsert({
    where: { code: 'SAVR-PHASE-1' },
    update: {
      branchId: branch.id,
      mainheadId: mainhead.id,
      clientOrganizationId: tnbOrganization.id,
      name: 'SAVR Phase 1 Operations',
      description: 'Default enterprise operations project for SAVR inspection rollout.',
      status: ProjectStatus.ACTIVE,
    },
    create: {
      branchId: branch.id,
      mainheadId: mainhead.id,
      clientOrganizationId: tnbOrganization.id,
      code: 'SAVR-PHASE-1',
      name: 'SAVR Phase 1 Operations',
      description: 'Default enterprise operations project for SAVR inspection rollout.',
      status: ProjectStatus.ACTIVE,
    },
  });

  const existingWorkPackage = await prisma.workPackage.findFirst({
    where: {
      projectId: project.id,
      code: 'SAVR-WP-001',
    },
    select: { id: true },
  });

  if (existingWorkPackage) {
    await prisma.workPackage.update({
      where: { id: existingWorkPackage.id },
      data: {
        name: 'SAVR Default Work Package',
        mainheadId: mainhead.id,
        area: 'Default',
        mainhead: 'SAVR',
        description: 'Default work package for SAVR field inspection operations.',
        status: WorkPackageStatus.ACTIVE,
      },
    });
  } else {
    await prisma.workPackage.create({
      data: {
        projectId: project.id,
        mainheadId: mainhead.id,
        code: 'SAVR-WP-001',
        name: 'SAVR Default Work Package',
        area: 'Default',
        mainhead: 'SAVR',
        description: 'Default work package for SAVR field inspection operations.',
        status: WorkPackageStatus.ACTIVE,
      },
    });
  }

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@ascure.local' },
    update: {
      tenantId: tenant.id,
      departmentId: department.id,
      name: 'ASCURE Admin',
      role: UserRole.ADMIN,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      departmentId: department.id,
      email: 'admin@ascure.local',
      name: 'ASCURE Admin',
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  await prisma.organizationMembership.upsert({
    where: {
      userId_organizationId: {
        userId: adminUser.id,
        organizationId: ascureOrganization.id,
      },
    },
    update: {
      isActive: true,
    },
    create: {
      userId: adminUser.id,
      organizationId: ascureOrganization.id,
      role: OrganizationMembershipRole.OWNER,
      isActive: true,
    },
  });

  const technicianUser = await prisma.user.upsert({
    where: { email: 'technician@ascure.local' },
    update: {
      tenantId: tenant.id,
      departmentId: department.id,
      name: 'Field Technician',
      role: UserRole.TECHNICIAN,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      departmentId: department.id,
      email: 'technician@ascure.local',
      name: 'Field Technician',
      passwordHash: technicianPasswordHash,
      role: UserRole.TECHNICIAN,
      isActive: true,
    },
  });

  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@ascure.local' },
    update: {
      tenantId: tenant.id,
      departmentId: department.id,
      name: 'Operations Manager',
      role: UserRole.MANAGER,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      departmentId: department.id,
      email: 'manager@ascure.local',
      name: 'Operations Manager',
      passwordHash: managerPasswordHash,
      role: UserRole.MANAGER,
      isActive: true,
    },
  });

  const supervisorUser = await prisma.user.upsert({
    where: { email: 'supervisor@ascure.local' },
    update: {
      tenantId: tenant.id,
      departmentId: department.id,
      name: 'Field Supervisor',
      role: UserRole.SUPERVISOR,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      departmentId: department.id,
      email: 'supervisor@ascure.local',
      name: 'Field Supervisor',
      passwordHash: supervisorPasswordHash,
      role: UserRole.SUPERVISOR,
      isActive: true,
    },
  });

  await prisma.teamMember.upsert({
    where: {
      teamId_userId: {
        teamId: team.id,
        userId: adminUser.id,
      },
    },
    update: { isActive: true },
    create: {
      teamId: team.id,
      userId: adminUser.id,
      isActive: true,
    },
  });

  await prisma.teamMember.upsert({
    where: {
      teamId_userId: {
        teamId: team.id,
        userId: managerUser.id,
      },
    },
    update: { isActive: true },
    create: {
      teamId: team.id,
      userId: managerUser.id,
      isActive: true,
    },
  });

  await prisma.teamMember.upsert({
    where: {
      teamId_userId: {
        teamId: team.id,
        userId: supervisorUser.id,
      },
    },
    update: { isActive: true },
    create: {
      teamId: team.id,
      userId: supervisorUser.id,
      isActive: true,
    },
  });

  await prisma.teamMember.upsert({
    where: {
      teamId_userId: {
        teamId: team.id,
        userId: technicianUser.id,
      },
    },
    update: { isActive: true },
    create: {
      teamId: team.id,
      userId: technicianUser.id,
      isActive: true,
    },
  });

  const substation = await prisma.substation.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: 'PCH-001',
      },
    },
    update: {
      name: 'Pencawang SSU Putra',
      location: 'Putrajaya',
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      code: 'PCH-001',
      name: 'Pencawang SSU Putra',
      location: 'Putrajaya',
      isActive: true,
    },
  });

  const assetType = await prisma.assetType.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: 'SAVR',
      },
    },
    update: {
      name: 'SAVR',
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      code: 'SAVR',
      name: 'SAVR',
      isActive: true,
    },
  });

  await prisma.asset.upsert({
    where: {
      tenantId_assetCode: {
        tenantId: tenant.id,
        assetCode: 'SAVR-001',
      },
    },
    update: {
      substationId: substation.id,
      assetTypeId: assetType.id,
      assetCode: 'SAVR-001',
      name: 'SAVR Unit 001',
      status: AssetStatus.ACTIVE,
    },
    create: {
      tenantId: tenant.id,
      substationId: substation.id,
      assetTypeId: assetType.id,
      assetCode: 'SAVR-001',
      name: 'SAVR Unit 001',
      status: AssetStatus.ACTIVE,
    },
  });

  const existingActiveTemplates = await prisma.inspectionTemplate.findMany({
    where: {
      assetTypeId: assetType.id,
      isActive: true,
    },
    select: { id: true },
  });

  if (existingActiveTemplates.length > 0) {
    await prisma.inspectionTemplate.updateMany({
      where: {
        id: {
          in: existingActiveTemplates.map((template) => template.id),
        },
      },
      data: {
        isActive: false,
        status: InspectionTemplateStatus.ARCHIVED,
      },
    });
  }

  const template = await prisma.inspectionTemplate.upsert({
    where: {
      assetTypeId_version: {
        assetTypeId: assetType.id,
        version: 1,
      },
    },
    update: {
      tenantId: tenant.id,
      name: 'SAVR Phase 1 Checklist',
      status: InspectionTemplateStatus.ACTIVE,
      isActive: true,
      publishedAt: new Date(),
    },
    create: {
      tenantId: tenant.id,
      assetTypeId: assetType.id,
      version: 1,
      name: 'SAVR Phase 1 Checklist',
      status: InspectionTemplateStatus.ACTIVE,
      isActive: true,
      publishedAt: new Date(),
    },
  });

  const existingSection = await prisma.inspectionTemplateSection.findFirst({
    where: {
      templateId: template.id,
      title: 'Visual Checks',
    },
    select: {
      id: true,
    },
  });

  const section = existingSection
    ? await prisma.inspectionTemplateSection.update({
        where: {
          id: existingSection.id,
        },
        data: {
          description: 'Basic SAVR inspection checklist for Phase 1 testing.',
          sortOrder: 1,
        },
      })
    : await prisma.inspectionTemplateSection.create({
        data: {
          templateId: template.id,
          title: 'Visual Checks',
          description: 'Basic SAVR inspection checklist for Phase 1 testing.',
          sortOrder: 1,
        },
      });

  const seedItems = [
    {
      key: 'nameplate_condition',
      label: 'Nameplate condition is acceptable',
      helperText: 'Mark true when the nameplate is readable and intact.',
      inputType: InspectionItemInputType.BOOLEAN,
      isRequired: true,
      sortOrder: 1,
    },
    {
      key: 'oil_level_reading',
      label: 'Oil level reading',
      helperText: 'Capture the observed oil level as text.',
      inputType: InspectionItemInputType.TEXT,
      isRequired: true,
      sortOrder: 2,
    },
    {
      key: 'inspection_notes',
      label: 'Inspection notes',
      helperText: 'Optional general remarks for the asset.',
      inputType: InspectionItemInputType.TEXT,
      isRequired: false,
      sortOrder: 3,
    },
  ];

  for (const item of seedItems) {
    await prisma.inspectionTemplateItem.upsert({
      where: {
        templateId_key: {
          templateId: template.id,
          key: item.key,
        },
      },
      update: {
        sectionId: section.id,
        label: item.label,
        helperText: item.helperText,
        inputType: item.inputType,
        isRequired: item.isRequired,
        sortOrder: item.sortOrder,
      },
      create: {
        templateId: template.id,
        sectionId: section.id,
        key: item.key,
        label: item.label,
        helperText: item.helperText,
        inputType: item.inputType,
        isRequired: item.isRequired,
        sortOrder: item.sortOrder,
      },
    });
  }

  console.log('Seed completed successfully.');
  console.log('Admin login: admin@ascure.local / Admin123!');
  console.log('Manager login: manager@ascure.local / Manager123!');
  console.log('Supervisor login: supervisor@ascure.local / Supervisor123!');
  console.log('Technician login: technician@ascure.local / Tech123!');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
