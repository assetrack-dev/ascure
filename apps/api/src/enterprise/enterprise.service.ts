import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  OperationalDomain,
  OrganizationType,
  Prisma,
  ProjectStatus,
  WorkPackageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  CANONICAL_CAPABILITY_CODES,
  MAINHEAD_ASSIGNABLE_CAPABILITY_CODES,
} from '../common/canonical-capabilities';
import {
  ListBranchesQueryDto,
  ListCapabilitiesQueryDto,
  ListMainheadsQueryDto,
  ListOrganizationsQueryDto,
  ListOperationalRegionsQueryDto,
  ListProjectsQueryDto,
  ListWorkPackagesQueryDto,
} from './dto/list-enterprise-query.dto';
import {
  CreateBranchDto,
  CreateCapabilityDto,
  CreateMainheadDto,
  CreateOperationalRegionDto,
  CreateOrganizationDto,
  CreateProjectDto,
  CreateWorkPackageDto,
  UpdateBranchDto,
  UpdateCapabilityDto,
  UpdateEnterpriseActiveDto,
  UpdateMainheadDto,
  UpdateOperationalRegionDto,
  UpdateOrganizationDto,
  UpdateProjectDto,
  UpdateProjectLifecycleStatusDto,
  UpdateWorkPackageDto,
  UpdateWorkPackageLifecycleStatusDto,
} from './dto/manage-enterprise.dto';

type PrismaClientLike = Prisma.TransactionClient | PrismaService;

const ORGANIZATION_INCLUDE = Prisma.validator<Prisma.OrganizationInclude>()({
  parentOrganization: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      isActive: true,
    },
  },
  capabilities: {
    select: {
      id: true,
      capability: true,
      isActive: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [
      {
        capability: 'asc',
      },
    ],
  },
  capabilityAssignments: {
    include: {
      capability: true,
    },
    orderBy: [
      {
        capability: {
          name: 'asc',
        },
      },
    ],
  },
  _count: {
    select: {
      branches: true,
      capabilities: true,
      capabilityAssignments: true,
      memberships: true,
      teams: true,
      assignedUsers: true,
    },
  },
});

const BRANCH_INCLUDE = Prisma.validator<Prisma.BranchInclude>()({
  organization: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      isActive: true,
    },
  },
  capabilityAssignments: {
    include: {
      capability: true,
    },
    orderBy: [
      {
        capability: {
          name: 'asc',
        },
      },
    ],
  },
  _count: {
    select: {
      mainheads: true,
      projects: true,
      teams: true,
      assignedUsers: true,
      capabilityAssignments: true,
    },
  },
});

const OPERATIONAL_REGION_INCLUDE =
  Prisma.validator<Prisma.OperationalRegionInclude>()({
    _count: {
      select: {
        mainheads: true,
        userAccesses: true,
        inspectionTemplates: true,
      },
    },
  });

const MAINHEAD_INCLUDE = Prisma.validator<Prisma.MainheadInclude>()({
  branch: {
    select: {
      id: true,
      organizationId: true,
      name: true,
      code: true,
      region: true,
      isActive: true,
      organization: {
        select: {
          id: true,
          name: true,
          code: true,
          type: true,
          isActive: true,
        },
      },
    },
  },
  operationalRegion: {
    select: {
      id: true,
      tenantId: true,
      name: true,
      code: true,
      state: true,
      isActive: true,
    },
  },
  // Maintenance handoff Phase 2 — the registered maintenance company.
  maintenanceOrganization: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      isActive: true,
    },
  },
  capabilityAssignments: {
    include: {
      capability: true,
    },
    orderBy: [
      {
        capability: {
          name: 'asc',
        },
      },
    ],
  },
  _count: {
    select: {
      projects: true,
      workPackages: true,
      siteVisits: true,
      teams: true,
      assignedUsers: true,
      userAccesses: true,
      capabilityAssignments: true,
    },
  },
});

const CAPABILITY_INCLUDE = Prisma.validator<Prisma.CapabilityInclude>()({
  _count: {
    select: {
      organizationAssignments: true,
      branchAssignments: true,
      mainheadAssignments: true,
      teamAssignments: true,
      userAssignments: true,
    },
  },
});

const PROJECT_INCLUDE = Prisma.validator<Prisma.ProjectInclude>()({
  // Governance G4 — Branch detached. Projects expose MAINHEAD (with its
  // Operational Region) and the client Organization for scope.
  mainhead: {
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      isActive: true,
      operationalRegion: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  },
  clientOrganization: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      isActive: true,
    },
  },
  _count: {
    select: {
      workPackages: true,
      memberships: true,
    },
  },
});

const WORK_PACKAGE_INCLUDE = Prisma.validator<Prisma.WorkPackageInclude>()({
  mainheadRecord: {
    select: {
      id: true,
      branchId: true,
      name: true,
      code: true,
      description: true,
      isActive: true,
    },
  },
  project: {
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      operationalDomain: true,
      mainhead: {
        select: {
          id: true,
          branchId: true,
          name: true,
          code: true,
          isActive: true,
        },
      },
      branch: {
        select: {
          id: true,
          name: true,
          code: true,
          organization: {
            select: {
              id: true,
              name: true,
              code: true,
              type: true,
            },
          },
        },
      },
    },
  },
  _count: {
    select: {
      assignments: true,
      siteVisits: true,
    },
  },
});

@Injectable()
export class EnterpriseService {
  constructor(private readonly prisma: PrismaService) {}

  async getOptions(user: RequestUser) {
    const [
      organizations,
      branches,
      operationalRegions,
      mainheads,
      capabilities,
      projects,
      workPackages,
    ] =
      await Promise.all([
        this.prisma.organization.findMany({
          orderBy: {
            name: 'asc',
          },
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            isActive: true,
          },
        }),
        this.prisma.branch.findMany({
          orderBy: [
            {
              organization: {
                name: 'asc',
              },
            },
            {
              name: 'asc',
            },
          ],
          select: {
            id: true,
            organizationId: true,
            name: true,
            code: true,
            region: true,
            isActive: true,
            organization: {
              select: {
                id: true,
                name: true,
                code: true,
                type: true,
                isActive: true,
              },
            },
          },
        }),
        this.prisma.operationalRegion.findMany({
          where: {
            tenantId: user.tenantId,
          },
          orderBy: [
            {
              isActive: 'desc',
            },
            {
              name: 'asc',
            },
          ],
          select: {
            id: true,
            tenantId: true,
            name: true,
            code: true,
            state: true,
            isActive: true,
          },
        }),
        this.prisma.mainhead.findMany({
          orderBy: [
            {
              isActive: 'desc',
            },
            {
              name: 'asc',
            },
          ],
          select: {
            id: true,
            branchId: true,
            operationalRegionId: true,
            name: true,
            code: true,
            description: true,
            isActive: true,
            operationalRegion: {
              select: {
                id: true,
                tenantId: true,
                name: true,
                code: true,
                state: true,
                isActive: true,
              },
            },
            branch: {
              select: {
                id: true,
                organizationId: true,
                name: true,
                code: true,
                region: true,
                organization: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    type: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        }),
        // Pilot Execution Sprint: assignment pickers (/enterprise/options)
        // expose only canonical, active capabilities. Legacy rows still live
        // in the Capability table and remain visible from the catalogue page
        // (/enterprise/capabilities) for governance.
        this.prisma.capability.findMany({
          where: {
            isActive: true,
            code: { in: Array.from(CANONICAL_CAPABILITY_CODES) },
          },
          orderBy: [
            {
              isActive: 'desc',
            },
            {
              name: 'asc',
            },
          ],
          select: {
            id: true,
            name: true,
            code: true,
            description: true,
            isActive: true,
          },
        }),
        this.prisma.project.findMany({
          orderBy: [
            {
              status: 'asc',
            },
            {
              name: 'asc',
            },
          ],
          select: {
            id: true,
            branchId: true,
            mainheadId: true,
            clientOrganizationId: true,
            name: true,
            code: true,
            status: true,
            operationalDomain: true,
          },
        }),
        this.prisma.workPackage.findMany({
          orderBy: [
            {
              status: 'asc',
            },
            {
              name: 'asc',
            },
          ],
          select: {
            id: true,
            projectId: true,
            mainheadId: true,
            name: true,
            code: true,
            status: true,
            operationalDomain: true,
          },
        }),
      ]);

    return {
      organizationTypes: Object.values(OrganizationType),
      operationalDomains: Object.values(OperationalDomain),
      projectStatuses: Object.values(ProjectStatus),
      workPackageStatuses: Object.values(WorkPackageStatus),
      organizations,
      branches,
      operationalRegions,
      mainheads,
      capabilities,
      projects,
      workPackages,
    };
  }

  async createOrganization(dto: CreateOrganizationDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertOrganizationExists(
          tx,
          dto.parentOrganizationId,
          'Parent organization',
        );

        const organization = await tx.organization.create({
          data: {
            name: this.normalizeRequiredString(dto.name, 'Organization name'),
            code: this.normalizeOptionalString(dto.code),
            type: dto.type,
            parentOrganizationId:
              this.normalizeOptionalString(dto.parentOrganizationId) ?? null,
            isActive: dto.isActive ?? true,
          },
          include: ORGANIZATION_INCLUDE,
        });

        if (dto.capabilityIds !== undefined) {
          await this.syncOrganizationCapabilities(
            tx,
            organization.id,
            dto.capabilityIds,
          );

          return tx.organization.findUniqueOrThrow({
            where: {
              id: organization.id,
            },
            include: ORGANIZATION_INCLUDE,
          });
        }

        return organization;
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'organization');
      throw error;
    }
  }

  async updateOrganization(id: string, dto: UpdateOrganizationDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertOrganizationExists(tx, id, 'Organization');

        if (dto.parentOrganizationId && dto.parentOrganizationId === id) {
          throw new BadRequestException(
            'Organization cannot be its own parent.',
          );
        }

        await this.assertOrganizationExists(
          tx,
          dto.parentOrganizationId,
          'Parent organization',
        );

        const data: Prisma.OrganizationUpdateInput = {};

        if (dto.name !== undefined) {
          data.name = this.normalizeRequiredString(
            dto.name,
            'Organization name',
          );
        }

        if (dto.code !== undefined) {
          data.code = this.normalizeOptionalString(dto.code);
        }

        if (dto.type !== undefined) {
          data.type = dto.type;
        }

        if (dto.parentOrganizationId !== undefined) {
          data.parentOrganization = dto.parentOrganizationId
            ? {
                connect: {
                  id: dto.parentOrganizationId,
                },
              }
            : {
                disconnect: true,
              };
        }

        if (dto.isActive !== undefined) {
          data.isActive = dto.isActive;
        }

        if (
          Object.keys(data).length === 0 &&
          dto.capabilityIds === undefined
        ) {
          this.assertHasChanges(data);
        }

        if (Object.keys(data).length > 0) {
          await tx.organization.update({
            where: {
              id,
            },
            data,
          });
        }

        if (dto.capabilityIds !== undefined) {
          await this.syncOrganizationCapabilities(tx, id, dto.capabilityIds);
        }

        return tx.organization.findUniqueOrThrow({
          where: {
            id,
          },
          include: ORGANIZATION_INCLUDE,
        });
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'organization');
      throw error;
    }
  }

  updateOrganizationActive(id: string, dto: UpdateEnterpriseActiveDto) {
    return this.prisma.organization.update({
      where: {
        id,
      },
      data: {
        isActive: dto.isActive,
      },
      include: ORGANIZATION_INCLUDE,
    });
  }

  async createBranch(dto: CreateBranchDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const organizationId = this.normalizeRequiredString(
          dto.organizationId,
          'Organization',
        );

        await this.assertOrganizationExists(tx, organizationId, 'Organization');
        await this.assertBranchCodeAvailable(
          tx,
          organizationId,
          dto.code,
        );

        const branch = await tx.branch.create({
          data: {
            organizationId,
            name: this.normalizeRequiredString(dto.name, 'Branch name'),
            code: this.normalizeOptionalString(dto.code),
            region: this.normalizeOptionalString(dto.region),
            isActive: dto.isActive ?? true,
          },
          include: BRANCH_INCLUDE,
        });

        if (dto.capabilityIds !== undefined) {
          await this.syncBranchCapabilities(tx, branch.id, dto.capabilityIds);

          return tx.branch.findUniqueOrThrow({
            where: {
              id: branch.id,
            },
            include: BRANCH_INCLUDE,
          });
        }

        return branch;
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'branch');
      throw error;
    }
  }

  async updateBranch(id: string, dto: UpdateBranchDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingBranch = await tx.branch.findUnique({
          where: {
            id,
          },
          select: {
            id: true,
            organizationId: true,
            code: true,
          },
        });

        if (!existingBranch) {
          throw new NotFoundException('Branch not found.');
        }

        const nextOrganizationId =
          dto.organizationId ?? existingBranch.organizationId;

        if (dto.organizationId !== undefined) {
          await this.assertOrganizationExists(
            tx,
            dto.organizationId,
            'Organization',
          );
        }

        if (
          dto.code !== undefined ||
          dto.organizationId !== undefined
        ) {
          await this.assertBranchCodeAvailable(
            tx,
            nextOrganizationId,
            dto.code ?? existingBranch.code,
            id,
          );
        }

        const data: Prisma.BranchUncheckedUpdateInput = {};

        if (dto.name !== undefined) {
          data.name = this.normalizeRequiredString(dto.name, 'Branch name');
        }

        if (dto.code !== undefined) {
          data.code = this.normalizeOptionalString(dto.code);
        }

        if (dto.region !== undefined) {
          data.region = this.normalizeOptionalString(dto.region);
        }

        if (dto.organizationId !== undefined) {
          data.organizationId = dto.organizationId;
        }

        if (dto.isActive !== undefined) {
          data.isActive = dto.isActive;
        }

        if (
          Object.keys(data).length === 0 &&
          dto.capabilityIds === undefined
        ) {
          this.assertHasChanges(data);
        }

        if (Object.keys(data).length > 0) {
          await tx.branch.update({
            where: {
              id,
            },
            data,
          });
        }

        if (dto.capabilityIds !== undefined) {
          await this.syncBranchCapabilities(tx, id, dto.capabilityIds);
        }

        return tx.branch.findUniqueOrThrow({
          where: {
            id,
          },
          include: BRANCH_INCLUDE,
        });
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'branch');
      throw error;
    }
  }

  updateBranchActive(id: string, dto: UpdateEnterpriseActiveDto) {
    return this.prisma.branch.update({
      where: {
        id,
      },
      data: {
        isActive: dto.isActive,
      },
      include: BRANCH_INCLUDE,
    });
  }

  async createCapability(dto: CreateCapabilityDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertCapabilityCodeAvailable(tx, dto.code);

        return tx.capability.create({
          data: {
            name: this.normalizeRequiredString(dto.name, 'Capability name'),
            code: this.normalizeRequiredString(dto.code, 'Capability code'),
            description: this.normalizeOptionalString(dto.description),
            isActive: dto.isActive ?? true,
          },
          include: CAPABILITY_INCLUDE,
        });
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'capability');
      throw error;
    }
  }

  async updateCapability(id: string, dto: UpdateCapabilityDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingCapability = await tx.capability.findUnique({
          where: {
            id,
          },
          select: {
            id: true,
            code: true,
          },
        });

        if (!existingCapability) {
          throw new NotFoundException('Capability not found.');
        }

        if (dto.code !== undefined) {
          await this.assertCapabilityCodeAvailable(tx, dto.code, id);
        }

        const data: Prisma.CapabilityUpdateInput = {};

        if (dto.name !== undefined) {
          data.name = this.normalizeRequiredString(
            dto.name,
            'Capability name',
          );
        }

        if (dto.code !== undefined) {
          data.code = this.normalizeRequiredString(
            dto.code,
            'Capability code',
          );
        }

        if (dto.description !== undefined) {
          data.description = this.normalizeOptionalString(dto.description);
        }

        if (dto.isActive !== undefined) {
          data.isActive = dto.isActive;
        }

        this.assertHasChanges(data);

        return tx.capability.update({
          where: {
            id,
          },
          data,
          include: CAPABILITY_INCLUDE,
        });
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'capability');
      throw error;
    }
  }

  updateCapabilityActive(id: string, dto: UpdateEnterpriseActiveDto) {
    return this.prisma.capability.update({
      where: {
        id,
      },
      data: {
        isActive: dto.isActive,
      },
      include: CAPABILITY_INCLUDE,
    });
  }

  async createMainhead(user: RequestUser, dto: CreateMainheadDto) {
    return this.prisma.$transaction(async (tx) => {
      // Governance G4 — Branch detached. No branch is created, upserted,
      // synced, or renamed here. An explicit existing branchId (if provided)
      // is linked as-is; otherwise the MAINHEAD has no branch.
      const branchId = dto.branchId ?? null;

      await this.assertOperationalRegionExists(
        user,
        dto.operationalRegionId,
        'Operational region',
        tx,
      );

      await this.assertMaintenanceOrganizationEligible(
        dto.maintenanceOrganizationId,
        tx,
      );

      const mainhead = await tx.mainhead.create({
        data: {
          branchId,
          operationalRegionId: this.normalizeOptionalString(
            dto.operationalRegionId,
          ),
          maintenanceOrganizationId:
            this.normalizeOptionalString(dto.maintenanceOrganizationId) ?? null,
          name: this.normalizeRequiredString(dto.name, 'MAINHEAD name'),
          code: this.normalizeOptionalString(dto.code),
          description: this.normalizeOptionalString(dto.description),
          isActive: dto.isActive ?? true,
        },
        include: MAINHEAD_INCLUDE,
      });

      if (dto.capabilityIds !== undefined) {
        await this.syncMainheadCapabilities(
          tx,
          mainhead.id,
          dto.capabilityIds,
        );

        return tx.mainhead.findUniqueOrThrow({
          where: {
            id: mainhead.id,
          },
          include: MAINHEAD_INCLUDE,
        });
      }

      return mainhead;
    });
  }

  async updateMainhead(user: RequestUser, id: string, dto: UpdateMainheadDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingMainhead = await tx.mainhead.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (!existingMainhead) {
        throw new NotFoundException('MAINHEAD not found.');
      }

      const data: Prisma.MainheadUpdateInput = {};

      // Governance G4 — Branch detached. MAINHEAD updates never resolve,
      // create, connect, disconnect, rename, or sync a Branch. MAINHEADs are
      // anchored by Operational Region only.

      if (dto.name !== undefined) {
        data.name = this.normalizeRequiredString(dto.name, 'MAINHEAD name');
      }

      if (dto.code !== undefined) {
        data.code = this.normalizeOptionalString(dto.code);
      }

      if (dto.description !== undefined) {
        data.description = this.normalizeOptionalString(dto.description);
      }

      if (dto.isActive !== undefined) {
        data.isActive = dto.isActive;
      }

      if (dto.operationalRegionId !== undefined) {
        await this.assertOperationalRegionExists(
          user,
          dto.operationalRegionId,
          'Operational region',
          tx,
        );
        data.operationalRegion = dto.operationalRegionId
          ? {
              connect: {
                id: dto.operationalRegionId,
              },
            }
          : {
              disconnect: true,
            };
      }

      if (dto.maintenanceOrganizationId !== undefined) {
        await this.assertMaintenanceOrganizationEligible(
          dto.maintenanceOrganizationId,
          tx,
        );
        data.maintenanceOrganization = dto.maintenanceOrganizationId
          ? {
              connect: {
                id: dto.maintenanceOrganizationId,
              },
            }
          : {
              disconnect: true,
            };
      }

      if (
        Object.keys(data).length === 0 &&
        dto.capabilityIds === undefined
      ) {
        this.assertHasChanges(data);
      }

      if (Object.keys(data).length > 0) {
        await tx.mainhead.update({
          where: {
            id,
          },
          data,
        });
      }

      if (dto.capabilityIds !== undefined) {
        await this.syncMainheadCapabilities(tx, id, dto.capabilityIds);
      }

      return tx.mainhead.findUniqueOrThrow({
        where: {
          id,
        },
        include: MAINHEAD_INCLUDE,
      });
    });
  }

  updateMainheadActive(id: string, dto: UpdateEnterpriseActiveDto) {
    return this.prisma.mainhead.update({
      where: {
        id,
      },
      data: {
        isActive: dto.isActive,
      },
      include: MAINHEAD_INCLUDE,
    });
  }

  async createProject(dto: CreateProjectDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Governance G4 — Projects are scoped by MAINHEAD / Operational Region.
        // Branch is detached: never created, upserted, synced, or renamed here.
        const mainhead = await this.resolveMainhead(tx, dto.mainheadId);
        const clientOrganizationId =
          dto.clientOrganizationId ?? dto.organizationId ?? null;

        await this.assertOrganizationExists(
          tx,
          clientOrganizationId,
          'Client organization',
        );

        return tx.project.create({
          data: {
            mainheadId: mainhead?.id ?? null,
            clientOrganizationId,
            name: this.normalizeRequiredString(dto.name, 'Project name'),
            code: this.normalizeOptionalString(dto.code),
            description: this.normalizeOptionalString(dto.description),
            status: dto.status ?? ProjectStatus.ACTIVE,
            operationalDomain: dto.operationalDomain ?? null,
            startDate: this.parseOptionalDate(dto.startDate, 'Start date'),
            endDate: this.parseOptionalDate(dto.endDate, 'End date'),
          },
          include: PROJECT_INCLUDE,
        });
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'project');
      throw error;
    }
  }

  async updateProject(id: string, dto: UpdateProjectDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingProject = await tx.project.findUnique({
          where: {
            id,
          },
          select: {
            id: true,
            name: true,
          },
        });

        if (!existingProject) {
          throw new NotFoundException('Project not found.');
        }

        const data: Prisma.ProjectUncheckedUpdateInput = {};

        // Governance G4 — Projects are scoped by MAINHEAD / Operational Region.
        // Branch is detached: never created, upserted, synced, or renamed here.
        if (dto.mainheadId !== undefined) {
          const mainhead = await this.resolveMainhead(tx, dto.mainheadId);
          data.mainheadId = mainhead?.id ?? null;
        }

        if (dto.name !== undefined) {
          data.name = this.normalizeRequiredString(dto.name, 'Project name');
        }

        if (dto.code !== undefined) {
          data.code = this.normalizeOptionalString(dto.code);
        }

        if (dto.description !== undefined) {
          data.description = this.normalizeOptionalString(dto.description);
        }

        if (
          dto.clientOrganizationId !== undefined ||
          dto.organizationId !== undefined
        ) {
          const clientOrganizationId =
            dto.clientOrganizationId ?? dto.organizationId ?? null;

          await this.assertOrganizationExists(
            tx,
            clientOrganizationId,
            'Client organization',
          );
          data.clientOrganizationId = clientOrganizationId;
        }

        if (dto.status !== undefined) {
          data.status = dto.status;
        }

        if (dto.operationalDomain !== undefined) {
          data.operationalDomain = dto.operationalDomain;
        }

        if (dto.startDate !== undefined) {
          data.startDate = this.parseOptionalDate(dto.startDate, 'Start date');
        }

        if (dto.endDate !== undefined) {
          data.endDate = this.parseOptionalDate(dto.endDate, 'End date');
        }

        this.assertHasChanges(data);

        return tx.project.update({
          where: {
            id,
          },
          data,
          include: PROJECT_INCLUDE,
        });
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'project');
      throw error;
    }
  }

  updateProjectStatus(id: string, dto: UpdateProjectLifecycleStatusDto) {
    return this.prisma.project.update({
      where: {
        id,
      },
      data: {
        status: dto.status,
      },
      include: PROJECT_INCLUDE,
    });
  }

  async createWorkPackage(dto: CreateWorkPackageDto) {
    return this.prisma.$transaction(async (tx) => {
      const project = await this.resolveProject(tx, dto.projectId);
      const mainhead = await this.resolveMainhead(
        tx,
        dto.mainheadId ?? project.mainheadId,
      );

      return tx.workPackage.create({
        data: {
          projectId: project.id,
          mainheadId: mainhead?.id ?? null,
          name: this.normalizeRequiredString(dto.name, 'Work package name'),
          code: this.normalizeOptionalString(dto.code),
          area: this.normalizeOptionalString(dto.area),
          mainhead:
            this.normalizeOptionalString(dto.mainhead) ??
            mainhead?.name ??
            null,
          description: this.normalizeOptionalString(dto.description),
          status: dto.status ?? WorkPackageStatus.ACTIVE,
          operationalDomain:
            dto.operationalDomain ?? project.operationalDomain ?? null,
        },
        include: WORK_PACKAGE_INCLUDE,
      });
    });
  }

  async updateWorkPackage(id: string, dto: UpdateWorkPackageDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingWorkPackage = await tx.workPackage.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          projectId: true,
        },
      });

      if (!existingWorkPackage) {
        throw new NotFoundException('Work package not found.');
      }

      const data: Prisma.WorkPackageUncheckedUpdateInput = {};
      const project =
        dto.projectId !== undefined
          ? await this.resolveProject(tx, dto.projectId)
          : null;
      const mainhead = await this.resolveMainhead(
        tx,
        dto.mainheadId ?? project?.mainheadId,
      );

      if (project) {
        data.projectId = project.id;
      }

      if (dto.mainheadId !== undefined || project?.mainheadId) {
        data.mainheadId = mainhead?.id ?? null;
      }

      if (dto.name !== undefined) {
        data.name = this.normalizeRequiredString(
          dto.name,
          'Work package name',
        );
      }

      if (dto.code !== undefined) {
        data.code = this.normalizeOptionalString(dto.code);
      }

      if (dto.area !== undefined) {
        data.area = this.normalizeOptionalString(dto.area);
      }

      if (dto.mainhead !== undefined || mainhead) {
        data.mainhead =
          this.normalizeOptionalString(dto.mainhead) ?? mainhead?.name ?? null;
      }

      if (dto.description !== undefined) {
        data.description = this.normalizeOptionalString(dto.description);
      }

      if (dto.status !== undefined) {
        data.status = dto.status;
      }

      if (dto.operationalDomain !== undefined) {
        data.operationalDomain = dto.operationalDomain;
      }

      this.assertHasChanges(data);

      return tx.workPackage.update({
        where: {
          id,
        },
        data,
        include: WORK_PACKAGE_INCLUDE,
      });
    });
  }

  updateWorkPackageStatus(
    id: string,
    dto: UpdateWorkPackageLifecycleStatusDto,
  ) {
    return this.prisma.workPackage.update({
      where: {
        id,
      },
      data: {
        status: dto.status,
      },
      include: WORK_PACKAGE_INCLUDE,
    });
  }

  listOrganizations(query: ListOrganizationsQueryDto) {
    return this.prisma.organization.findMany({
      where: this.organizationWhere(query),
      include: ORGANIZATION_INCLUDE,
      orderBy: [
        {
          name: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });
  }

  async getOrganization(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: {
        id,
      },
      include: ORGANIZATION_INCLUDE,
    });

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    return organization;
  }

  listBranches(query: ListBranchesQueryDto) {
    return this.prisma.branch.findMany({
      where: this.branchWhere(query),
      include: BRANCH_INCLUDE,
      orderBy: [
        {
          organization: {
            name: 'asc',
          },
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  async getBranch(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: {
        id,
      },
      include: BRANCH_INCLUDE,
    });

    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }

    return branch;
  }

  listOperationalRegions(
    user: RequestUser,
    query: ListOperationalRegionsQueryDto,
  ) {
    return this.prisma.operationalRegion.findMany({
      where: {
        tenantId: user.tenantId,
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      },
      include: OPERATIONAL_REGION_INCLUDE,
      orderBy: [
        {
          isActive: 'desc',
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  async createOperationalRegion(
    user: RequestUser,
    dto: CreateOperationalRegionDto,
  ) {
    try {
      return await this.prisma.operationalRegion.create({
        data: {
          tenantId: user.tenantId,
          name: this.normalizeRequiredString(dto.name, 'Region name'),
          code: this.normalizeRequiredString(dto.code, 'Region code'),
          state: this.normalizeOptionalString(dto.state),
          isActive: dto.isActive ?? true,
        },
        include: OPERATIONAL_REGION_INCLUDE,
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'operational region');
      throw error;
    }
  }

  async updateOperationalRegion(
    user: RequestUser,
    id: string,
    dto: UpdateOperationalRegionDto,
  ) {
    await this.assertOperationalRegionExists(
      user,
      id,
      'Operational region',
    );
    const data: Prisma.OperationalRegionUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = this.normalizeRequiredString(dto.name, 'Region name');
    }

    if (dto.code !== undefined) {
      data.code = this.normalizeRequiredString(dto.code, 'Region code');
    }

    if (dto.state !== undefined) {
      data.state = this.normalizeOptionalString(dto.state);
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    this.assertHasChanges(data);

    try {
      return await this.prisma.operationalRegion.update({
        where: {
          id,
        },
        data,
        include: OPERATIONAL_REGION_INCLUDE,
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error, 'operational region');
      throw error;
    }
  }

  updateOperationalRegionActive(
    user: RequestUser,
    id: string,
    dto: UpdateEnterpriseActiveDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOperationalRegionExists(
        user,
        id,
        'Operational region',
        tx,
      );

      return tx.operationalRegion.update({
      where: {
        id,
      },
      data: {
        isActive: dto.isActive,
      },
      include: OPERATIONAL_REGION_INCLUDE,
      });
    });
  }

  async getOperationalRegion(user: RequestUser, id: string) {
    const operationalRegion = await this.prisma.operationalRegion.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
      },
      include: OPERATIONAL_REGION_INCLUDE,
    });

    if (!operationalRegion) {
      throw new NotFoundException('Operational region not found.');
    }

    return operationalRegion;
  }

  listCapabilities(query: ListCapabilitiesQueryDto) {
    return this.prisma.capability.findMany({
      where: {
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      },
      include: CAPABILITY_INCLUDE,
      orderBy: [
        {
          isActive: 'desc',
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  async getCapability(id: string) {
    const capability = await this.prisma.capability.findUnique({
      where: {
        id,
      },
      include: CAPABILITY_INCLUDE,
    });

    if (!capability) {
      throw new NotFoundException('Capability not found.');
    }

    return capability;
  }

  listMainheads(query: ListMainheadsQueryDto) {
    return this.prisma.mainhead.findMany({
      where: this.mainheadWhere(query),
      include: MAINHEAD_INCLUDE,
      orderBy: [
        {
          isActive: 'desc',
        },
        {
          operationalRegion: {
            name: 'asc',
          },
        },
        {
          branch: {
            name: 'asc',
          },
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  async getMainhead(id: string) {
    const mainhead = await this.prisma.mainhead.findUnique({
      where: {
        id,
      },
      include: MAINHEAD_INCLUDE,
    });

    if (!mainhead) {
      throw new NotFoundException('MAINHEAD not found.');
    }

    return mainhead;
  }

  listProjects(query: ListProjectsQueryDto) {
    return this.prisma.project.findMany({
      where: this.projectWhere(query),
      include: PROJECT_INCLUDE,
      orderBy: [
        {
          status: 'asc',
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  async getProject(id: string) {
    const project = await this.prisma.project.findUnique({
      where: {
        id,
      },
      include: PROJECT_INCLUDE,
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  listWorkPackages(query: ListWorkPackagesQueryDto) {
    return this.prisma.workPackage.findMany({
      where: this.workPackageWhere(query),
      include: WORK_PACKAGE_INCLUDE,
      orderBy: [
        {
          status: 'asc',
        },
        {
          mainhead: 'asc',
        },
        {
          name: 'asc',
        },
      ],
    });
  }

  async getWorkPackage(id: string) {
    const workPackage = await this.prisma.workPackage.findUnique({
      where: {
        id,
      },
      include: WORK_PACKAGE_INCLUDE,
    });

    if (!workPackage) {
      throw new NotFoundException('Work package not found.');
    }

    return workPackage;
  }

  private async resolveMainhead(
    tx: Prisma.TransactionClient,
    mainheadId?: string | null,
  ) {
    if (!mainheadId) {
      return null;
    }

    const mainhead = await tx.mainhead.findUnique({
      where: {
        id: mainheadId,
      },
      select: {
        id: true,
        branchId: true,
        name: true,
      },
    });

    if (!mainhead) {
      throw new NotFoundException('MAINHEAD not found.');
    }

    return mainhead;
  }

  private async resolveProject(
    tx: Prisma.TransactionClient,
    projectId: string,
  ) {
    const project = await tx.project.findUnique({
      where: {
        id: projectId,
      },
      select: {
        id: true,
        mainheadId: true,
        operationalDomain: true,
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private normalizeIdList(ids: string[] | undefined) {
    if (!ids) {
      return [];
    }

    return Array.from(
      new Set(
        ids
          .map((id) => this.normalizeOptionalString(id))
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }

  private async assertCapabilitiesExist(
    tx: Prisma.TransactionClient,
    capabilityIds: string[],
  ) {
    if (capabilityIds.length === 0) {
      return;
    }

    const count = await tx.capability.count({
      where: {
        id: {
          in: capabilityIds,
        },
      },
    });

    if (count !== capabilityIds.length) {
      throw new NotFoundException('One or more capabilities were not found.');
    }
  }

  /**
   * Governance G2 — MAINHEAD Capability Restriction.
   *
   * MAINHEADs may only be assigned Asset Domain capabilities (SAVR, SAVT,
   * PENCAWANG, FEEDER_PILLAR, LINK_BOX, CABLE_BRIDGE, UNDERGROUND_CABLE,
   * THERMAL_INSPECTION). Workspace Access and Governance & Reporting codes
   * are rejected here so the UI restriction cannot be bypassed by direct
   * API callers. Existing non-asset-domain rows already in the database are
   * left untouched (no destructive cleanup); they are simply no longer
   * editable through the UI and are not consulted by the effective
   * capability resolver.
   */
  private async assertMainheadCapabilitiesAllowed(
    tx: Prisma.TransactionClient,
    capabilityIds: string[],
  ) {
    if (capabilityIds.length === 0) {
      return;
    }

    const capabilities = await tx.capability.findMany({
      where: {
        id: {
          in: capabilityIds,
        },
      },
      select: {
        id: true,
        code: true,
      },
    });

    const disallowed = capabilities.filter(
      (capability) =>
        !MAINHEAD_ASSIGNABLE_CAPABILITY_CODES.has(
          capability.code.trim().toUpperCase(),
        ),
    );

    if (disallowed.length > 0) {
      throw new BadRequestException({
        message: 'MAINHEADs may only be assigned Asset Domain capabilities.',
        disallowedCapabilities: disallowed.map((capability) => ({
          id: capability.id,
          code: capability.code,
        })),
      });
    }
  }

  private async syncOrganizationCapabilities(
    tx: Prisma.TransactionClient,
    organizationId: string,
    capabilityIds: string[] | undefined,
  ) {
    const normalizedCapabilityIds = this.normalizeIdList(capabilityIds);
    await this.assertCapabilitiesExist(tx, normalizedCapabilityIds);

    await tx.organizationCapabilityAssignment.deleteMany({
      where: {
        organizationId,
        ...(normalizedCapabilityIds.length > 0
          ? {
              capabilityId: {
                notIn: normalizedCapabilityIds,
              },
            }
          : {}),
      },
    });

    for (const capabilityId of normalizedCapabilityIds) {
      await tx.organizationCapabilityAssignment.upsert({
        where: {
          organizationId_capabilityId: {
            organizationId,
            capabilityId,
          },
        },
        create: {
          id: randomUUID(),
          organizationId,
          capabilityId,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }
  }

  private async syncBranchCapabilities(
    tx: Prisma.TransactionClient,
    branchId: string,
    capabilityIds: string[] | undefined,
  ) {
    const normalizedCapabilityIds = this.normalizeIdList(capabilityIds);
    await this.assertCapabilitiesExist(tx, normalizedCapabilityIds);

    await tx.branchCapability.deleteMany({
      where: {
        branchId,
        ...(normalizedCapabilityIds.length > 0
          ? {
              capabilityId: {
                notIn: normalizedCapabilityIds,
              },
            }
          : {}),
      },
    });

    for (const capabilityId of normalizedCapabilityIds) {
      await tx.branchCapability.upsert({
        where: {
          branchId_capabilityId: {
            branchId,
            capabilityId,
          },
        },
        create: {
          id: randomUUID(),
          branchId,
          capabilityId,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }
  }

  private async syncMainheadCapabilities(
    tx: Prisma.TransactionClient,
    mainheadId: string,
    capabilityIds: string[] | undefined,
  ) {
    const normalizedCapabilityIds = this.normalizeIdList(capabilityIds);
    await this.assertCapabilitiesExist(tx, normalizedCapabilityIds);
    await this.assertMainheadCapabilitiesAllowed(tx, normalizedCapabilityIds);

    await tx.mainheadCapability.deleteMany({
      where: {
        mainheadId,
        ...(normalizedCapabilityIds.length > 0
          ? {
              capabilityId: {
                notIn: normalizedCapabilityIds,
              },
            }
          : {}),
      },
    });

    for (const capabilityId of normalizedCapabilityIds) {
      await tx.mainheadCapability.upsert({
        where: {
          mainheadId_capabilityId: {
            mainheadId,
            capabilityId,
          },
        },
        create: {
          id: randomUUID(),
          mainheadId,
          capabilityId,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }
  }

  private async assertOrganizationExists(
    tx: Prisma.TransactionClient,
    organizationId: string | null | undefined,
    label: string,
  ) {
    if (!organizationId) {
      return;
    }

    const organization = await tx.organization.findUnique({
      where: {
        id: organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!organization) {
      throw new NotFoundException(`${label} not found.`);
    }
  }

  private async assertOperationalRegionExists(
    user: RequestUser,
    operationalRegionId: string | null | undefined,
    label: string,
    client: PrismaClientLike = this.prisma,
  ) {
    if (!operationalRegionId) {
      return;
    }

    const operationalRegion = await client.operationalRegion.findFirst({
      where: {
        id: operationalRegionId,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!operationalRegion) {
      throw new NotFoundException(`${label} not found.`);
    }
  }

  /**
   * Maintenance handoff Phase 2 — a MAINHEAD's registered maintenance company
   * must be an active contractor org (the maintainer is a MAIN_CONTRACTOR that
   * self-assigns internally or subcontracts; SUBCONTRACTOR is allowed for the
   * case a sub is registered directly). Null/undefined clears the link.
   */
  private async assertMaintenanceOrganizationEligible(
    maintenanceOrganizationId: string | null | undefined,
    client: PrismaClientLike = this.prisma,
  ) {
    if (!maintenanceOrganizationId) {
      return;
    }

    const organization = await client.organization.findUnique({
      where: {
        id: maintenanceOrganizationId,
      },
      select: {
        id: true,
        isActive: true,
        type: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Maintenance company not found.');
    }

    if (!organization.isActive) {
      throw new BadRequestException(
        'The selected maintenance company is inactive.',
      );
    }

    if (
      organization.type !== OrganizationType.MAIN_CONTRACTOR &&
      organization.type !== OrganizationType.SUBCONTRACTOR
    ) {
      throw new BadRequestException(
        'The maintenance company must be a MAIN_CONTRACTOR or SUBCONTRACTOR organisation.',
      );
    }
  }

  private async assertBranchCodeAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    code: string | null | undefined,
    branchId?: string,
  ) {
    const normalizedCode = this.normalizeOptionalString(code);

    if (!normalizedCode) {
      return;
    }

    const existingBranch = await tx.branch.findFirst({
      where: {
        organizationId,
        code: {
          equals: normalizedCode,
          mode: Prisma.QueryMode.insensitive,
        },
        ...(branchId
          ? {
              id: {
                not: branchId,
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingBranch) {
      throw new ConflictException(
        'A branch with this code already exists for this organization.',
      );
    }
  }

  private async assertCapabilityCodeAvailable(
    tx: Prisma.TransactionClient,
    code: string | null | undefined,
    capabilityId?: string,
  ) {
    const normalizedCode = this.normalizeRequiredString(
      code,
      'Capability code',
    );

    const existingCapability = await tx.capability.findFirst({
      where: {
        code: {
          equals: normalizedCode,
          mode: Prisma.QueryMode.insensitive,
        },
        ...(capabilityId
          ? {
              id: {
                not: capabilityId,
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingCapability) {
      throw new ConflictException(
        'A capability with this code already exists.',
      );
    }
  }

  private assertHasChanges(data: object) {
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'At least one editable field must be provided.',
      );
    }
  }

  private parseOptionalDate(
    value: string | null | undefined,
    label: string,
  ) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label} must be a valid date.`);
    }

    return date;
  }

  private normalizeRequiredString(value: string | null | undefined, label: string) {
    const normalizedValue = this.normalizeOptionalString(value);

    if (!normalizedValue) {
      throw new BadRequestException(`${label} is required.`);
    }

    return normalizedValue;
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }

  private throwDuplicateCodeConflict(error: unknown, label: string) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(`A ${label} with this code already exists.`);
    }
  }

  private organizationWhere(
    query: ListOrganizationsQueryDto,
  ): Prisma.OrganizationWhereInput {
    return {
      ...(query.type ? { type: query.type } : {}),
      ...(query.capability
        ? {
            OR: [
              {
                capabilities: {
                  some: {
                    capability: query.capability,
                  },
                },
              },
              {
                capabilityAssignments: {
                  some: {
                    capability: {
                      code: query.capability,
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
  }

  private branchWhere(query: ListBranchesQueryDto): Prisma.BranchWhereInput {
    return {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
  }

  private mainheadWhere(
    query: ListMainheadsQueryDto,
  ): Prisma.MainheadWhereInput {
    return {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.operationalRegionId
        ? { operationalRegionId: query.operationalRegionId }
        : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
  }

  private projectWhere(query: ListProjectsQueryDto): Prisma.ProjectWhereInput {
    return {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.operationalDomain
        ? { operationalDomain: query.operationalDomain }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };
  }

  private workPackageWhere(
    query: ListWorkPackagesQueryDto,
  ): Prisma.WorkPackageWhereInput {
    const mainhead = query.mainhead?.trim();

    return {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.operationalDomain
        ? { operationalDomain: query.operationalDomain }
        : {}),
      ...(mainhead
        ? {
            mainhead: {
              contains: mainhead,
              mode: 'insensitive',
            },
          }
        : {}),
    };
  }
}
