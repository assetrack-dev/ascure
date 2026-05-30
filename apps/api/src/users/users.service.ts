import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const PASSWORD_SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser) {
    return this.prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
      },
      orderBy: [
        {
          name: 'asc',
        },
        {
          email: 'asc',
        },
      ],
      select: this.userSelect(),
    });
  }

  async create(user: RequestUser, dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertDepartmentBelongsToTenant(
          tx,
          user.tenantId,
          dto.departmentId,
        );
        await this.assertEmailAvailable(tx, dto.email);
        const operationalLinks = await this.resolveOperationalLinks(tx, user.tenantId, {
          organizationId: dto.organizationId,
          branchId: dto.branchId,
          mainheadId: dto.mainheadId,
          teamId: dto.teamId,
        });

        const createdUser = await tx.user.create({
          data: {
            tenantId: user.tenantId,
            departmentId: dto.departmentId ?? null,
            organizationId: operationalLinks.organizationId,
            branchId: operationalLinks.branchId,
            mainheadId: operationalLinks.mainheadId,
            teamId: operationalLinks.teamId,
            email: dto.email,
            name: dto.name,
            passwordHash,
            role: dto.role,
            isActive: dto.isActive ?? true,
          },
          select: this.userSelect(),
        });

        if (operationalLinks.teamId) {
          await this.syncPrimaryTeamMembership(
            tx,
            createdUser.id,
            null,
            operationalLinks.teamId,
          );
        }

        if (dto.capabilityIds !== undefined) {
          await this.syncUserCapabilities(tx, createdUser.id, dto.capabilityIds);

          return tx.user.findUniqueOrThrow({
            where: {
              id: createdUser.id,
            },
            select: this.userSelect(),
          });
        }

        return createdUser;
      });
    } catch (error) {
      this.throwConflictForDuplicateEmail(error);
      throw error;
    }
  }

  async update(user: RequestUser, id: string, dto: UpdateUserDto) {
    try {
      return await this.runSerializableUserTransaction(async (tx) => {
        const existingUser = await tx.user.findFirst({
          where: {
            id,
            tenantId: user.tenantId,
          },
          select: {
            id: true,
            role: true,
            isActive: true,
            organizationId: true,
            branchId: true,
            mainheadId: true,
            teamId: true,
          },
        });

        if (!existingUser) {
          throw new NotFoundException('User not found.');
        }

        await this.assertDepartmentBelongsToTenant(
          tx,
          user.tenantId,
          dto.departmentId,
        );
        const shouldResolveOperationalLinks =
          dto.organizationId !== undefined ||
          dto.branchId !== undefined ||
          dto.mainheadId !== undefined ||
          dto.teamId !== undefined;
        const operationalLinks = shouldResolveOperationalLinks
          ? await this.resolveOperationalLinks(tx, user.tenantId, {
              organizationId:
                dto.organizationId === undefined
                  ? existingUser.organizationId
                  : dto.organizationId,
              branchId:
                dto.branchId === undefined ? existingUser.branchId : dto.branchId,
              mainheadId:
                dto.mainheadId === undefined
                  ? existingUser.mainheadId
                  : dto.mainheadId,
              teamId: dto.teamId === undefined ? existingUser.teamId : dto.teamId,
            })
          : null;

        const data: Prisma.UserUncheckedUpdateInput = {};

        if (dto.name !== undefined) {
          data.name = dto.name;
        }

        if (dto.email !== undefined) {
          await this.assertEmailAvailable(tx, dto.email, id);
          data.email = dto.email;
        }

        if (dto.role !== undefined) {
          if (
            existingUser.role === UserRole.ADMIN &&
            existingUser.isActive &&
            dto.role !== UserRole.ADMIN
          ) {
            await this.assertAnotherActiveAdminExists(tx, user.tenantId, id);
          }

          data.role = dto.role;
        }

        if (dto.departmentId !== undefined) {
          data.departmentId = dto.departmentId;
        }

        if (operationalLinks) {
          data.organizationId = operationalLinks.organizationId;
          data.branchId = operationalLinks.branchId;
          data.mainheadId = operationalLinks.mainheadId;
          data.teamId = operationalLinks.teamId;
        }

        if (
          Object.keys(data).length === 0 &&
          dto.capabilityIds === undefined
        ) {
          throw new BadRequestException(
            'At least one editable user field must be provided.',
          );
        }

        if (Object.keys(data).length > 0) {
          await tx.user.update({
            where: {
              id,
            },
            data,
          });
        }

        if (operationalLinks) {
          await this.syncPrimaryTeamMembership(
            tx,
            id,
            existingUser.teamId,
            operationalLinks.teamId,
          );
        }

        if (dto.capabilityIds !== undefined) {
          await this.syncUserCapabilities(tx, id, dto.capabilityIds);
        }

        return tx.user.findUniqueOrThrow({
          where: {
            id,
          },
          select: this.userSelect(),
        });
      });
    } catch (error) {
      this.throwConflictForDuplicateEmail(error);
      throw error;
    }
  }

  async updatePassword(
    user: RequestUser,
    id: string,
    dto: UpdateUserPasswordDto,
  ) {
    const targetUser = await this.prisma.user.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found.');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    return this.prisma.user.update({
      where: {
        id,
      },
      data: {
        passwordHash,
      },
      select: this.userSelect(),
    });
  }

  async updateStatus(
    user: RequestUser,
    id: string,
    dto: UpdateUserStatusDto,
  ) {
    if (id === user.id && !dto.isActive) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    return this.runSerializableUserTransaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          id,
          tenantId: user.tenantId,
        },
        select: {
          id: true,
          role: true,
          isActive: true,
        },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found.');
      }

      if (
        existingUser.role === UserRole.ADMIN &&
        existingUser.isActive &&
        !dto.isActive
      ) {
        await this.assertAnotherActiveAdminExists(tx, user.tenantId, id);
      }

      return tx.user.update({
        where: {
          id,
        },
        data: {
          isActive: dto.isActive,
        },
        select: this.userSelect(),
      });
    });
  }

  async getCurrentUserTeams(user: RequestUser) {
    const memberships = await this.prisma.teamMember.findMany({
      where: {
        userId: user.id,
        isActive: true,
        team: {
          tenantId: user.tenantId,
          isActive: true,
        },
      },
      select: {
        team: {
          select: {
            id: true,
            tenantId: true,
            departmentId: true,
            organizationId: true,
            branchId: true,
            mainheadId: true,
            code: true,
            name: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return memberships
      .map((membership) => membership.team)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getCurrentUserMainheads(user: RequestUser) {
    const include = {
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
    } satisfies Prisma.MainheadInclude;
    const activeMainheadWhere = {
      isActive: true,
      branch: {
        isActive: true,
        organization: {
          isActive: true,
        },
      },
    } satisfies Prisma.MainheadWhereInput;

    if (user.role === UserRole.ADMIN) {
      const mainheads = await this.prisma.mainhead.findMany({
        where: activeMainheadWhere,
        include,
        orderBy: this.mainheadOrderBy(),
      });

      return mainheads.map((mainhead) => this.serializeMainheadOption(mainhead));
    }

    const currentUser = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        organizationId: true,
        branchId: true,
        mainheadId: true,
        teamMemberships: {
          where: {
            isActive: true,
            team: {
              tenantId: user.tenantId,
              isActive: true,
            },
          },
          select: {
            team: {
              select: {
                organizationId: true,
                branchId: true,
                mainheadId: true,
              },
            },
          },
        },
      },
    });

    if (!currentUser) {
      return [];
    }

    const mainheadIds = new Set<string>();
    const branchIds = new Set<string>();
    const organizationIds = new Set<string>();

    this.addOptionalId(mainheadIds, currentUser.mainheadId);
    this.addOptionalId(branchIds, currentUser.branchId);
    this.addOptionalId(organizationIds, currentUser.organizationId);

    for (const membership of currentUser.teamMemberships) {
      this.addOptionalId(mainheadIds, membership.team.mainheadId);
      this.addOptionalId(branchIds, membership.team.branchId);
      this.addOptionalId(organizationIds, membership.team.organizationId);
    }

    const accessFilters: Prisma.MainheadWhereInput[] = [];

    if (mainheadIds.size > 0) {
      accessFilters.push({
        id: {
          in: Array.from(mainheadIds),
        },
      });
    }

    if (branchIds.size > 0) {
      accessFilters.push({
        branchId: {
          in: Array.from(branchIds),
        },
      });
    }

    if (organizationIds.size > 0) {
      accessFilters.push({
        branch: {
          organizationId: {
            in: Array.from(organizationIds),
          },
        },
      });
    }

    if (accessFilters.length === 0) {
      return [];
    }

    const mainheads = await this.prisma.mainhead.findMany({
      where: {
        ...activeMainheadWhere,
        OR: accessFilters,
      },
      include,
      orderBy: this.mainheadOrderBy(),
    });

    return mainheads.map((mainhead) => this.serializeMainheadOption(mainhead));
  }

  private userSelect() {
    return {
      id: true,
      tenantId: true,
      departmentId: true,
      organizationId: true,
      branchId: true,
      mainheadId: true,
      teamId: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      department: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
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
      team: {
        select: {
          id: true,
          tenantId: true,
          departmentId: true,
          organizationId: true,
          branchId: true,
          mainheadId: true,
          code: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
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
    } satisfies Prisma.UserSelect;
  }

  private addOptionalId(target: Set<string>, value?: string | null) {
    if (value) {
      target.add(value);
    }
  }

  private mainheadOrderBy(): Prisma.MainheadOrderByWithRelationInput[] {
    return [
      {
        branch: {
          name: 'asc',
        },
      },
      {
        name: 'asc',
      },
    ];
  }

  private serializeMainheadOption(
    mainhead: Prisma.MainheadGetPayload<{
      include: {
        branch: {
          select: {
            id: true;
            organizationId: true;
            name: true;
            code: true;
            region: true;
            isActive: true;
            organization: {
              select: {
                id: true;
                name: true;
                code: true;
                type: true;
                isActive: true;
              };
            };
          };
        };
      };
    }>,
  ) {
    return {
      id: mainhead.id,
      name: mainhead.name,
      code: mainhead.code,
      branchId: mainhead.branchId,
      organizationId: mainhead.branch.organizationId,
      description: mainhead.description,
      isActive: mainhead.isActive,
      branch: mainhead.branch,
    };
  }

  private async resolveOperationalLinks(
    tx: Prisma.TransactionClient,
    tenantId: string,
    input: {
      organizationId?: string | null;
      branchId?: string | null;
      mainheadId?: string | null;
      teamId?: string | null;
    },
  ) {
    let organizationId = this.normalizeOptionalString(input.organizationId);
    let branchId = this.normalizeOptionalString(input.branchId);
    let mainheadId = this.normalizeOptionalString(input.mainheadId);
    const teamId = this.normalizeOptionalString(input.teamId);

    if (teamId) {
      const team = await tx.team.findFirst({
        where: {
          id: teamId,
          tenantId,
        },
        select: {
          id: true,
          organizationId: true,
          branchId: true,
          mainheadId: true,
        },
      });

      if (!team) {
        throw new NotFoundException('Team not found.');
      }

      if (team.organizationId) {
        if (organizationId && organizationId !== team.organizationId) {
          throw new BadRequestException(
            'Selected team does not belong to the selected organization.',
          );
        }

        organizationId = team.organizationId;
      }

      if (team.branchId) {
        if (branchId && branchId !== team.branchId) {
          throw new BadRequestException(
            'Selected team does not belong to the selected branch.',
          );
        }

        branchId = team.branchId;
      }

      if (team.mainheadId) {
        if (mainheadId && mainheadId !== team.mainheadId) {
          throw new BadRequestException(
            'Selected team does not belong to the selected MAINHEAD.',
          );
        }

        mainheadId = team.mainheadId;
      }
    }

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

      branchId = mainhead.branchId;

      if (
        organizationId &&
        organizationId !== mainhead.branch.organizationId
      ) {
        throw new BadRequestException(
          'Selected MAINHEAD does not belong to the selected organization.',
        );
      }

      organizationId = mainhead.branch.organizationId;
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
      teamId,
    };
  }

  private async syncPrimaryTeamMembership(
    tx: Prisma.TransactionClient,
    userId: string,
    previousTeamId: string | null,
    nextTeamId: string | null,
  ) {
    if (previousTeamId && previousTeamId !== nextTeamId) {
      await tx.teamMember.updateMany({
        where: {
          teamId: previousTeamId,
          userId,
        },
        data: {
          isActive: false,
        },
      });
    }

    if (!nextTeamId) {
      return;
    }

    await tx.teamMember.upsert({
      where: {
        teamId_userId: {
          teamId: nextTeamId,
          userId,
        },
      },
      create: {
        id: randomUUID(),
        teamId: nextTeamId,
        userId,
        isActive: true,
      },
      update: {
        isActive: true,
      },
    });
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

  private async syncUserCapabilities(
    tx: Prisma.TransactionClient,
    userId: string,
    capabilityIds: string[] | undefined,
  ) {
    const normalizedCapabilityIds = this.normalizeIdList(capabilityIds);
    await this.assertCapabilitiesExist(tx, normalizedCapabilityIds);

    await tx.userCapability.deleteMany({
      where: {
        userId,
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
      await tx.userCapability.upsert({
        where: {
          userId_capabilityId: {
            userId,
            capabilityId,
          },
        },
        create: {
          id: randomUUID(),
          userId,
          capabilityId,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }

  private async assertDepartmentBelongsToTenant(
    tx: Prisma.TransactionClient,
    tenantId: string,
    departmentId: string | null | undefined,
  ) {
    if (!departmentId) {
      return;
    }

    const department = await tx.department.findFirst({
      where: {
        id: departmentId,
        tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found.');
    }
  }

  private async assertEmailAvailable(
    tx: Prisma.TransactionClient,
    email: string,
    userId?: string,
  ) {
    const existingUser = await tx.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: Prisma.QueryMode.insensitive,
        },
        ...(userId
          ? {
              id: {
                not: userId,
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email already exists.');
    }
  }

  private async assertAnotherActiveAdminExists(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
  ) {
    const activeAdminCount = await tx.user.count({
      where: {
        tenantId,
        role: UserRole.ADMIN,
        isActive: true,
        id: {
          not: userId,
        },
      },
    });

    if (activeAdminCount === 0) {
      throw new BadRequestException('At least one active admin user must remain.');
    }
  }

  private async runSerializableUserTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (this.isTransactionConflict(error)) {
        throw new ConflictException(
          'User record changed while saving. Please reload and try again.',
        );
      }

      throw error;
    }
  }

  private isTransactionConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  private throwConflictForDuplicateEmail(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A user with this email already exists.');
    }
  }
}
