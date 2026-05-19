import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListBranchesQueryDto,
  ListMainheadsQueryDto,
  ListOrganizationsQueryDto,
  ListProjectsQueryDto,
  ListWorkPackagesQueryDto,
} from './dto/list-enterprise-query.dto';

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
