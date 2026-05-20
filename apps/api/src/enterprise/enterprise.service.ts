import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OperationalDomain,
  OrganizationType,
  Prisma,
  ProjectStatus,
  WorkPackageStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListBranchesQueryDto,
  ListMainheadsQueryDto,
  ListOrganizationsQueryDto,
  ListProjectsQueryDto,
  ListWorkPackagesQueryDto,
} from './dto/list-enterprise-query.dto';
import {
  CreateMainheadDto,
  CreateOrganizationDto,
  CreateProjectDto,
  CreateWorkPackageDto,
  UpdateEnterpriseActiveDto,
  UpdateMainheadDto,
  UpdateOrganizationDto,
  UpdateProjectDto,
  UpdateProjectLifecycleStatusDto,
  UpdateWorkPackageDto,
  UpdateWorkPackageLifecycleStatusDto,
} from './dto/manage-enterprise.dto';

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
  _count: {
    select: {
      branches: true,
      capabilities: true,
      memberships: true,
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
  _count: {
    select: {
      mainheads: true,
      projects: true,
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
  _count: {
    select: {
      projects: true,
      workPackages: true,
      siteVisits: true,
    },
  },
});

const PROJECT_INCLUDE = Prisma.validator<Prisma.ProjectInclude>()({
  branch: {
    select: {
      id: true,
      name: true,
      code: true,
      region: true,
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
  mainhead: {
    select: {
      id: true,
      branchId: true,
      name: true,
      code: true,
      description: true,
      isActive: true,
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

  async getOptions() {
    const [organizations, branches, mainheads, projects, workPackages] =
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
            name: true,
            code: true,
            description: true,
            isActive: true,
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
      mainheads,
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

        return tx.organization.create({
          data: {
            name: this.normalizeRequiredString(dto.name, 'Organization name'),
            code: this.normalizeOptionalString(dto.code),
            type: dto.type ?? OrganizationType.OTHER,
            parentOrganizationId:
              this.normalizeOptionalString(dto.parentOrganizationId) ?? null,
            isActive: dto.isActive ?? true,
          },
          include: ORGANIZATION_INCLUDE,
        });
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

        this.assertHasChanges(data);

        return tx.organization.update({
          where: {
            id,
          },
          data,
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

  async createMainhead(dto: CreateMainheadDto) {
    return this.prisma.$transaction(async (tx) => {
      const branchId = await this.resolveBranchId(tx, {
        branchId: dto.branchId,
        organizationId: dto.organizationId,
        branchName: dto.branchName,
        branchCode: dto.branchCode,
        region: dto.region,
        fallbackName: dto.name,
      });

      return tx.mainhead.create({
        data: {
          branchId,
          name: this.normalizeRequiredString(dto.name, 'MAINHEAD name'),
          code: this.normalizeOptionalString(dto.code),
          description: this.normalizeOptionalString(dto.description),
          isActive: dto.isActive ?? true,
        },
        include: MAINHEAD_INCLUDE,
      });
    });
  }

  async updateMainhead(id: string, dto: UpdateMainheadDto) {
    return this.prisma.$transaction(async (tx) => {
      const existingMainhead = await tx.mainhead.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          branchId: true,
          name: true,
        },
      });

      if (!existingMainhead) {
        throw new NotFoundException('MAINHEAD not found.');
      }

      const data: Prisma.MainheadUpdateInput = {};
      let branchChanged = false;
      const shouldResolveBranch =
        dto.branchId !== undefined || dto.organizationId !== undefined;

      if (shouldResolveBranch) {
        data.branch = {
          connect: {
            id: await this.resolveBranchId(tx, {
              branchId: dto.branchId,
              organizationId: dto.organizationId,
              branchName: dto.branchName,
              branchCode: dto.branchCode,
              region: dto.region,
              fallbackName: dto.name ?? existingMainhead.name,
            }),
          },
        };
        branchChanged = true;
      } else if (
        dto.branchName !== undefined ||
        dto.branchCode !== undefined ||
        dto.region !== undefined
      ) {
        await tx.branch.update({
          where: {
            id: existingMainhead.branchId,
          },
          data: {
            ...(dto.branchName !== undefined
              ? {
                  name: this.normalizeRequiredString(
                    dto.branchName,
                    'Branch name',
                  ),
                }
              : {}),
            ...(dto.branchCode !== undefined
              ? { code: this.normalizeOptionalString(dto.branchCode) }
              : {}),
            ...(dto.region !== undefined
              ? { region: this.normalizeOptionalString(dto.region) }
            : {}),
          },
        });
        branchChanged = true;
      }

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

      if (!branchChanged) {
        this.assertHasChanges(data);
      }

      return tx.mainhead.update({
        where: {
          id,
        },
        data,
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
        const mainhead = await this.resolveMainhead(tx, dto.mainheadId);
        const branchId =
          mainhead?.branchId ??
          (await this.resolveBranchId(tx, {
            branchId: dto.branchId,
            organizationId: dto.organizationId ?? dto.clientOrganizationId,
            branchName: dto.branchName,
            branchCode: dto.branchCode,
            region: dto.region,
            fallbackName: dto.name,
          }));
        const clientOrganizationId =
          dto.clientOrganizationId ?? dto.organizationId ?? null;

        await this.assertOrganizationExists(
          tx,
          clientOrganizationId,
          'Client organization',
        );

        return tx.project.create({
          data: {
            branchId,
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
            branchId: true,
          },
        });

        if (!existingProject) {
          throw new NotFoundException('Project not found.');
        }

        const data: Prisma.ProjectUncheckedUpdateInput = {};
        const mainhead = await this.resolveMainhead(tx, dto.mainheadId);

        if (dto.mainheadId !== undefined) {
          data.mainheadId = mainhead?.id ?? null;
          data.branchId = mainhead?.branchId ?? existingProject.branchId;
        }

        if (dto.branchId !== undefined || dto.organizationId !== undefined) {
          data.branchId = await this.resolveBranchId(tx, {
            branchId: dto.branchId,
            organizationId: dto.organizationId ?? dto.clientOrganizationId,
            branchName: dto.branchName,
            branchCode: dto.branchCode,
            region: dto.region,
            fallbackName: dto.name ?? existingProject.name,
          });
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

  listMainheads(query: ListMainheadsQueryDto) {
    return this.prisma.mainhead.findMany({
      where: this.mainheadWhere(query),
      include: MAINHEAD_INCLUDE,
      orderBy: [
        {
          isActive: 'desc',
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

  private async resolveBranchId(
    tx: Prisma.TransactionClient,
    input: {
      branchId?: string | null;
      organizationId?: string | null;
      branchName?: string | null;
      branchCode?: string | null;
      region?: string | null;
      fallbackName: string;
    },
  ) {
    if (input.branchId) {
      const branch = await tx.branch.findUnique({
        where: {
          id: input.branchId,
        },
        select: {
          id: true,
        },
      });

      if (!branch) {
        throw new NotFoundException('Branch not found.');
      }

      return branch.id;
    }

    const organizationId = this.normalizeOptionalString(input.organizationId);

    if (!organizationId) {
      throw new BadRequestException(
        'Branch or organization is required for this record.',
      );
    }

    await this.assertOrganizationExists(tx, organizationId, 'Organization');

    const branchName =
      this.normalizeOptionalString(input.branchName) ??
      `${this.normalizeRequiredString(input.fallbackName, 'Branch name')} Branch`;
    const branchCode = this.normalizeOptionalString(input.branchCode);

    const existingBranch = await tx.branch.findFirst({
      where: {
        organizationId,
        ...(branchCode
          ? {
              code: {
                equals: branchCode,
                mode: Prisma.QueryMode.insensitive,
              },
            }
          : {
              name: {
                equals: branchName,
                mode: Prisma.QueryMode.insensitive,
              },
            }),
      },
      select: {
        id: true,
      },
    });

    if (existingBranch) {
      return existingBranch.id;
    }

    const branch = await tx.branch.create({
      data: {
        organizationId,
        name: branchName,
        code: branchCode,
        region: this.normalizeOptionalString(input.region),
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    return branch.id;
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
            capabilities: {
              some: {
                capability: query.capability,
              },
            },
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
