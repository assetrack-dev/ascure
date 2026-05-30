import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, UserRole } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto, UpdateTeamDto, UpdateTeamStatusDto } from './dto/manage-team.dto';

const TEAM_INCLUDE = Prisma.validator<Prisma.TeamInclude>()({
  organization: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
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
      isActive: true,
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
      members: true,
      siteVisits: true,
      assignedDefects: true,
      assignedToDefects: true,
      assignedUsers: true,
      capabilityAssignments: true,
    },
  },
});

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: RequestUser) {
    return this.prisma.team.findMany({
      where: {
        tenantId: user.tenantId,
        ...(user.role === UserRole.ADMIN ? {} : { isActive: true }),
      },
      include: TEAM_INCLUDE,
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

  async create(user: RequestUser, dto: CreateTeamDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertTeamCodeAvailable(tx, user.tenantId, dto.code);
        const operationalLinks = await this.resolveOperationalLinks(tx, {
          organizationId: dto.organizationId,
          branchId: dto.branchId,
          mainheadId: dto.mainheadId,
        });

        const team = await tx.team.create({
          data: {
            tenantId: user.tenantId,
            name: this.normalizeRequiredString(dto.name, 'Team name'),
            code: this.normalizeRequiredString(dto.code, 'Team code'),
            organizationId: operationalLinks.organizationId,
            branchId: operationalLinks.branchId,
            mainheadId: operationalLinks.mainheadId,
            isActive: dto.isActive ?? true,
          },
          include: TEAM_INCLUDE,
        });

        if (dto.capabilityIds !== undefined) {
          await this.syncTeamCapabilities(tx, team.id, dto.capabilityIds);

          return tx.team.findUniqueOrThrow({
            where: {
              id: team.id,
            },
            include: TEAM_INCLUDE,
          });
        }

        return team;
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error);
      throw error;
    }
  }

  async update(user: RequestUser, id: string, dto: UpdateTeamDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingTeam = await tx.team.findFirst({
          where: {
            id,
            tenantId: user.tenantId,
          },
          select: {
            id: true,
            code: true,
            organizationId: true,
            branchId: true,
            mainheadId: true,
          },
        });

        if (!existingTeam) {
          throw new NotFoundException('Team not found.');
        }

        if (dto.code !== undefined) {
          await this.assertTeamCodeAvailable(tx, user.tenantId, dto.code, id);
        }

        const shouldResolveOperationalLinks =
          dto.organizationId !== undefined ||
          dto.branchId !== undefined ||
          dto.mainheadId !== undefined;
        const operationalLinks = shouldResolveOperationalLinks
          ? await this.resolveOperationalLinks(tx, {
              organizationId:
                dto.organizationId === undefined
                  ? existingTeam.organizationId
                  : dto.organizationId,
              branchId:
                dto.branchId === undefined ? existingTeam.branchId : dto.branchId,
              mainheadId:
                dto.mainheadId === undefined
                  ? existingTeam.mainheadId
                  : dto.mainheadId,
            })
          : null;

        const data: Prisma.TeamUncheckedUpdateInput = {};

        if (dto.name !== undefined) {
          data.name = this.normalizeRequiredString(dto.name, 'Team name');
        }

        if (dto.code !== undefined) {
          data.code = this.normalizeRequiredString(dto.code, 'Team code');
        }

        if (operationalLinks) {
          data.organizationId = operationalLinks.organizationId;
          data.branchId = operationalLinks.branchId;
          data.mainheadId = operationalLinks.mainheadId;
        }

        if (dto.isActive !== undefined) {
          data.isActive = dto.isActive;
        }

        if (
          Object.keys(data).length === 0 &&
          dto.capabilityIds === undefined
        ) {
          throw new BadRequestException(
            'At least one editable team field must be provided.',
          );
        }

        if (Object.keys(data).length > 0) {
          await tx.team.update({
            where: {
              id,
            },
            data,
          });
        }

        if (dto.capabilityIds !== undefined) {
          await this.syncTeamCapabilities(tx, id, dto.capabilityIds);
        }

        return tx.team.findUniqueOrThrow({
          where: {
            id,
          },
          include: TEAM_INCLUDE,
        });
      });
    } catch (error) {
      this.throwDuplicateCodeConflict(error);
      throw error;
    }
  }

  async updateStatus(user: RequestUser, id: string, dto: UpdateTeamStatusDto) {
    const team = await this.prisma.team.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    return this.prisma.team.update({
      where: {
        id,
      },
      data: {
        isActive: dto.isActive,
      },
      include: TEAM_INCLUDE,
    });
  }

  private async resolveOperationalLinks(
    tx: Prisma.TransactionClient,
    input: {
      organizationId?: string | null;
      branchId?: string | null;
      mainheadId?: string | null;
    },
  ) {
    let organizationId = this.normalizeOptionalString(input.organizationId);
    let branchId = this.normalizeOptionalString(input.branchId);
    const mainheadId = this.normalizeOptionalString(input.mainheadId);

    if (mainheadId) {
      const mainhead = await tx.mainhead.findUnique({
        where: {
          id: mainheadId,
        },
        select: {
          id: true,
          branchId: true,
          branch: {
            select: {
              organizationId: true,
            },
          },
        },
      });

      if (!mainhead) {
        throw new NotFoundException('MAINHEAD not found.');
      }

      if (branchId && branchId !== mainhead.branchId) {
        throw new BadRequestException(
          'Selected MAINHEAD does not belong to the selected branch.',
        );
      }

      branchId = mainhead.branchId ?? branchId;

      if (
        organizationId &&
        mainhead.branch &&
        organizationId !== mainhead.branch.organizationId
      ) {
        throw new BadRequestException(
          'Selected MAINHEAD does not belong to the selected organization.',
        );
      }

      organizationId = mainhead.branch?.organizationId ?? organizationId;
    }

    if (branchId) {
      const branch = await tx.branch.findUnique({
        where: {
          id: branchId,
        },
        select: {
          id: true,
          organizationId: true,
        },
      });

      if (!branch) {
        throw new NotFoundException('Branch not found.');
      }

      if (organizationId && organizationId !== branch.organizationId) {
        throw new BadRequestException(
          'Selected branch does not belong to the selected organization.',
        );
      }

      organizationId = branch.organizationId;
    }

    if (organizationId) {
      const organization = await tx.organization.findUnique({
        where: {
          id: organizationId,
        },
        select: {
          id: true,
        },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found.');
      }
    }

    return {
      organizationId,
      branchId,
      mainheadId,
    };
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

  private async syncTeamCapabilities(
    tx: Prisma.TransactionClient,
    teamId: string,
    capabilityIds: string[] | undefined,
  ) {
    const normalizedCapabilityIds = this.normalizeIdList(capabilityIds);
    await this.assertCapabilitiesExist(tx, normalizedCapabilityIds);

    await tx.teamCapability.deleteMany({
      where: {
        teamId,
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
      await tx.teamCapability.upsert({
        where: {
          teamId_capabilityId: {
            teamId,
            capabilityId,
          },
        },
        create: {
          id: randomUUID(),
          teamId,
          capabilityId,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }
  }

  private async assertTeamCodeAvailable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    code: string | null | undefined,
    teamId?: string,
  ) {
    const normalizedCode = this.normalizeRequiredString(code, 'Team code');
    const existingTeam = await tx.team.findFirst({
      where: {
        tenantId,
        code: {
          equals: normalizedCode,
          mode: Prisma.QueryMode.insensitive,
        },
        ...(teamId
          ? {
              id: {
                not: teamId,
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingTeam) {
      throw new ConflictException('A team with this code already exists.');
    }
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

  private throwDuplicateCodeConflict(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A team with this code already exists.');
    }
  }
}
