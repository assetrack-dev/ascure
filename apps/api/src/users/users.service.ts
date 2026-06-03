import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MainheadAccessRole, OrganizationType, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const PASSWORD_SALT_ROUNDS = 10;

export type CapabilitySource =
  | { scope: 'ADMIN' }
  | { scope: 'USER' }
  | { scope: 'TEAM'; scopeId: string; scopeName: string }
  | { scope: 'MAINHEAD'; scopeId: string; scopeName: string }
  | { scope: 'BRANCH'; scopeId: string; scopeName: string }
  | { scope: 'ORGANIZATION'; scopeId: string; scopeName: string };

export interface EffectiveCapability {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sources: CapabilitySource[];
}

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
        const requestedMainheadAccessIds = this.normalizeIdList(
          dto.mainheadAccessIds,
        );
        const requestedOperationalRegionAccessIds = this.normalizeIdList(
          dto.operationalRegionAccessIds,
        );
        const legacyMainheadId =
          dto.mainheadId ?? requestedMainheadAccessIds[0] ?? null;
        const operationalLinks = await this.resolveOperationalLinks(tx, user.tenantId, {
          organizationId: dto.organizationId,
          branchId: dto.branchId,
          mainheadId: legacyMainheadId,
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

        if (
          dto.mainheadAccessIds !== undefined ||
          operationalLinks.mainheadId
        ) {
          await this.syncUserMainheadAccesses(
            tx,
            createdUser.id,
            dto.mainheadAccessIds === undefined
              ? operationalLinks.mainheadId
                ? [operationalLinks.mainheadId]
                : []
              : requestedMainheadAccessIds,
            dto.accessRole,
          );
        }

        if (dto.operationalRegionAccessIds !== undefined) {
          await this.syncUserOperationalRegionAccesses(
            tx,
            createdUser.id,
            requestedOperationalRegionAccessIds,
            dto.accessRole,
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

        if (
          dto.mainheadAccessIds !== undefined ||
          dto.operationalRegionAccessIds !== undefined ||
          operationalLinks.mainheadId
        ) {
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
        const requestedMainheadAccessIds =
          dto.mainheadAccessIds === undefined
            ? undefined
            : this.normalizeIdList(dto.mainheadAccessIds);
        const requestedOperationalRegionAccessIds =
          dto.operationalRegionAccessIds === undefined
            ? undefined
            : this.normalizeIdList(dto.operationalRegionAccessIds);
        const shouldResolveOperationalLinks =
          dto.organizationId !== undefined ||
          dto.branchId !== undefined ||
          dto.mainheadId !== undefined ||
          dto.teamId !== undefined ||
          requestedMainheadAccessIds !== undefined;
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
                  ? requestedMainheadAccessIds === undefined
                    ? existingUser.mainheadId
                    : requestedMainheadAccessIds[0] ?? null
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
          dto.capabilityIds === undefined &&
          requestedMainheadAccessIds === undefined &&
          requestedOperationalRegionAccessIds === undefined
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

        if (requestedMainheadAccessIds !== undefined) {
          await this.syncUserMainheadAccesses(
            tx,
            id,
            requestedMainheadAccessIds,
            dto.accessRole,
          );
        }

        if (requestedOperationalRegionAccessIds !== undefined) {
          await this.syncUserOperationalRegionAccesses(
            tx,
            id,
            requestedOperationalRegionAccessIds,
            dto.accessRole,
          );
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

  async getCurrentUserCapabilities(user: RequestUser): Promise<EffectiveCapability[]> {
    return this.resolveEffectiveCapabilities(user.tenantId, user.id);
  }

  async getCapabilitiesForUser(
    actor: RequestUser,
    userId: string,
  ): Promise<EffectiveCapability[]> {
    const target = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId: actor.tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!target) {
      throw new NotFoundException('User not found.');
    }

    return this.resolveEffectiveCapabilities(actor.tenantId, userId);
  }

  private async resolveEffectiveCapabilities(
    tenantId: string,
    userId: string,
  ): Promise<EffectiveCapability[]> {
    const userData = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
      },
      select: {
        role: true,
        organizationId: true,
        branchId: true,
        mainheadId: true,
        mainheadAccesses: {
          select: {
            mainheadId: true,
          },
        },
        operationalRegionAccesses: {
          select: {
            operationalRegionId: true,
          },
        },
        teamMemberships: {
          where: {
            isActive: true,
            team: {
              tenantId,
              isActive: true,
            },
          },
          select: {
            team: {
              select: {
                id: true,
                organizationId: true,
                branchId: true,
                mainheadId: true,
              },
            },
          },
        },
        organizationMemberships: {
          where: {
            isActive: true,
            organization: {
              isActive: true,
            },
          },
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!userData) {
      return [];
    }

    if (userData.role === UserRole.ADMIN) {
      const all = await this.prisma.capability.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          code: 'asc',
        },
      });

      return all.map((capability) => ({
        id: capability.id,
        code: capability.code,
        name: capability.name,
        description: capability.description ?? null,
        sources: [{ scope: 'ADMIN' as const }],
      }));
    }

    const teamIds = new Set<string>();
    const directMainheadIds = new Set<string>();
    const branchIds = new Set<string>();
    const organizationIds = new Set<string>();

    for (const membership of userData.teamMemberships) {
      teamIds.add(membership.team.id);
      if (membership.team.mainheadId) {
        directMainheadIds.add(membership.team.mainheadId);
      }
      if (membership.team.branchId) {
        branchIds.add(membership.team.branchId);
      }
      if (membership.team.organizationId) {
        organizationIds.add(membership.team.organizationId);
      }
    }

    if (userData.mainheadId) {
      directMainheadIds.add(userData.mainheadId);
    }

    for (const access of userData.mainheadAccesses) {
      directMainheadIds.add(access.mainheadId);
    }

    if (userData.branchId) {
      branchIds.add(userData.branchId);
    }

    if (userData.organizationId) {
      organizationIds.add(userData.organizationId);
    }

    for (const membership of userData.organizationMemberships) {
      organizationIds.add(membership.organizationId);
    }

    const regionIds = userData.operationalRegionAccesses
      .map((access) => access.operationalRegionId)
      .filter((value): value is string => Boolean(value));

    if (regionIds.length > 0) {
      const regionMainheads = await this.prisma.mainhead.findMany({
        where: {
          operationalRegionId: {
            in: regionIds,
          },
          isActive: true,
        },
        select: {
          id: true,
          branchId: true,
        },
      });

      for (const mainhead of regionMainheads) {
        directMainheadIds.add(mainhead.id);
        if (mainhead.branchId) {
          branchIds.add(mainhead.branchId);
        }
      }
    }

    if (directMainheadIds.size > 0) {
      const mainheads = await this.prisma.mainhead.findMany({
        where: {
          id: {
            in: Array.from(directMainheadIds),
          },
          isActive: true,
        },
        select: {
          id: true,
          branchId: true,
        },
      });

      for (const mainhead of mainheads) {
        if (mainhead.branchId) {
          branchIds.add(mainhead.branchId);
        }
      }
    }

    if (branchIds.size > 0) {
      const branches = await this.prisma.branch.findMany({
        where: {
          id: {
            in: Array.from(branchIds),
          },
          isActive: true,
        },
        select: {
          id: true,
          organizationId: true,
        },
      });

      for (const branch of branches) {
        organizationIds.add(branch.organizationId);
      }
    }

    const capabilitySelect = {
      capability: {
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
        },
      },
    } as const;

    const teamIdList = Array.from(teamIds);
    const branchIdList = Array.from(branchIds);
    const organizationIdList = Array.from(organizationIds);

    // Governance G2 — MAINHEAD Capability Restriction.
    //
    // MAINHEAD capabilities are no longer merged into the user's effective
    // authority set. MAINHEAD remains an operational-scope label; user
    // authority resolves exclusively from User + Team + Branch + Organization
    // assignments. The MAINHEAD -> branch derivation above is preserved so
    // BranchCapability inheritance via the MAINHEAD's branch still flows.
    // UserMainheadAccess / UserOperationalRegionAccess visibility is
    // unchanged.
    const [
      userCapabilities,
      teamCapabilities,
      branchCapabilities,
      organizationCapabilities,
    ] = await Promise.all([
      this.prisma.userCapability.findMany({
        where: {
          userId,
          isActive: true,
          capability: {
            isActive: true,
          },
        },
        select: capabilitySelect,
      }),
      teamIdList.length > 0
        ? this.prisma.teamCapability.findMany({
            where: {
              teamId: {
                in: teamIdList,
              },
              isActive: true,
              capability: {
                isActive: true,
              },
            },
            select: {
              ...capabilitySelect,
              team: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      branchIdList.length > 0
        ? this.prisma.branchCapability.findMany({
            where: {
              branchId: {
                in: branchIdList,
              },
              isActive: true,
              branch: {
                isActive: true,
              },
              capability: {
                isActive: true,
              },
            },
            select: {
              ...capabilitySelect,
              branch: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      organizationIdList.length > 0
        ? this.prisma.organizationCapabilityAssignment.findMany({
            where: {
              organizationId: {
                in: organizationIdList,
              },
              isActive: true,
              organization: {
                isActive: true,
              },
              capability: {
                isActive: true,
              },
            },
            select: {
              ...capabilitySelect,
              organization: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const accumulator = new Map<string, EffectiveCapability>();

    const recordSource = (
      capability: { id: string; code: string; name: string; description: string | null },
      source: CapabilitySource,
    ) => {
      const existing = accumulator.get(capability.id);

      if (existing) {
        existing.sources.push(source);
        return;
      }

      accumulator.set(capability.id, {
        id: capability.id,
        code: capability.code,
        name: capability.name,
        description: capability.description ?? null,
        sources: [source],
      });
    };

    for (const row of userCapabilities) {
      recordSource(row.capability, { scope: 'USER' });
    }

    for (const row of teamCapabilities) {
      recordSource(row.capability, {
        scope: 'TEAM',
        scopeId: row.team.id,
        scopeName: row.team.name,
      });
    }

    for (const row of branchCapabilities) {
      recordSource(row.capability, {
        scope: 'BRANCH',
        scopeId: row.branch.id,
        scopeName: row.branch.name,
      });
    }

    for (const row of organizationCapabilities) {
      recordSource(row.capability, {
        scope: 'ORGANIZATION',
        scopeId: row.organization.id,
        scopeName: row.organization.name,
      });
    }

    return Array.from(accumulator.values()).sort((left, right) =>
      left.code.localeCompare(right.code),
    );
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
    } satisfies Prisma.MainheadInclude;
    const activeMainheadWhere = {
      isActive: true,
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
        organization: {
          select: {
            type: true,
            isActive: true,
          },
        },
        capabilityAssignments: {
          where: {
            isActive: true,
            capability: {
              code: 'QA_VALIDATION',
              isActive: true,
            },
          },
          select: {
            id: true,
          },
        },
        mainheadAccesses: {
          select: {
            mainheadId: true,
          },
        },
        operationalRegionAccesses: {
          select: {
            operationalRegionId: true,
          },
        },
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

    if (this.hasGlobalMainheadAccess(currentUser)) {
      const mainheads = await this.prisma.mainhead.findMany({
        where: activeMainheadWhere,
        include,
        orderBy: this.mainheadOrderBy(),
      });

      return mainheads.map((mainhead) => this.serializeMainheadOption(mainhead));
    }

    const mainheadIds = new Set<string>();
    const branchIds = new Set<string>();
    const operationalRegionIds = new Set<string>();

    this.addOptionalId(mainheadIds, currentUser.mainheadId);
    this.addOptionalId(branchIds, currentUser.branchId);

    for (const access of currentUser.mainheadAccesses) {
      this.addOptionalId(mainheadIds, access.mainheadId);
    }

    for (const access of currentUser.operationalRegionAccesses) {
      this.addOptionalId(operationalRegionIds, access.operationalRegionId);
    }

    for (const membership of currentUser.teamMemberships) {
      this.addOptionalId(mainheadIds, membership.team.mainheadId);
      this.addOptionalId(branchIds, membership.team.branchId);
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

    if (operationalRegionIds.size > 0) {
      accessFilters.push({
        operationalRegionId: {
          in: Array.from(operationalRegionIds),
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
      mainheadAccesses: {
        include: {
          mainhead: {
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
            },
          },
        },
        orderBy: [
          {
            mainhead: {
              name: 'asc',
            },
          },
        ],
      },
      operationalRegionAccesses: {
        include: {
          operationalRegion: true,
        },
        orderBy: [
          {
            operationalRegion: {
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
        operationalRegion: {
          select: {
            id: true;
            tenantId: true;
            name: true;
            code: true;
            state: true;
            isActive: true;
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
      operationalRegionId: mainhead.operationalRegionId,
      organizationId: mainhead.branch?.organizationId ?? null,
      description: mainhead.description,
      isActive: mainhead.isActive,
      branch: mainhead.branch,
      operationalRegion: mainhead.operationalRegion,
    };
  }

  private hasGlobalMainheadAccess(user: {
    organization: {
      type: OrganizationType;
      isActive: boolean;
    } | null;
    capabilityAssignments: Array<{ id: string }>;
  }) {
    return (
      user.organization?.type === OrganizationType.ASCURE &&
      user.organization.isActive &&
      user.capabilityAssignments.length > 0
    );
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
        },
      });

      if (!mainhead) {
        throw new NotFoundException('MAINHEAD not found.');
      }
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

  private async assertMainheadsExist(
    tx: Prisma.TransactionClient,
    mainheadIds: string[],
  ) {
    if (mainheadIds.length === 0) {
      return;
    }

    const count = await tx.mainhead.count({
      where: {
        id: {
          in: mainheadIds,
        },
      },
    });

    if (count !== mainheadIds.length) {
      throw new NotFoundException('One or more MAINHEAD records were not found.');
    }
  }

  private async syncUserMainheadAccesses(
    tx: Prisma.TransactionClient,
    userId: string,
    mainheadIds: string[],
    accessRole?: MainheadAccessRole,
  ) {
    const normalizedMainheadIds = this.normalizeIdList(mainheadIds);
    await this.assertMainheadsExist(tx, normalizedMainheadIds);

    await tx.userMainheadAccess.deleteMany({
      where: {
        userId,
        ...(normalizedMainheadIds.length > 0
          ? {
              mainheadId: {
                notIn: normalizedMainheadIds,
              },
            }
          : {}),
      },
    });

    for (const mainheadId of normalizedMainheadIds) {
      await tx.userMainheadAccess.upsert({
        where: {
          userId_mainheadId: {
            userId,
            mainheadId,
          },
        },
        create: {
          id: randomUUID(),
          userId,
          mainheadId,
          accessRole: accessRole ?? null,
        },
        update: {
          accessRole: accessRole ?? undefined,
        },
      });
    }
  }

  private async assertOperationalRegionsExist(
    tx: Prisma.TransactionClient,
    operationalRegionIds: string[],
  ) {
    if (operationalRegionIds.length === 0) {
      return;
    }

    const count = await tx.operationalRegion.count({
      where: {
        id: {
          in: operationalRegionIds,
        },
      },
    });

    if (count !== operationalRegionIds.length) {
      throw new NotFoundException(
        'One or more operational regions were not found.',
      );
    }
  }

  private async syncUserOperationalRegionAccesses(
    tx: Prisma.TransactionClient,
    userId: string,
    operationalRegionIds: string[],
    accessRole?: MainheadAccessRole,
  ) {
    const normalizedOperationalRegionIds = this.normalizeIdList(
      operationalRegionIds,
    );
    await this.assertOperationalRegionsExist(
      tx,
      normalizedOperationalRegionIds,
    );

    await tx.userOperationalRegionAccess.deleteMany({
      where: {
        userId,
        ...(normalizedOperationalRegionIds.length > 0
          ? {
              operationalRegionId: {
                notIn: normalizedOperationalRegionIds,
              },
            }
          : {}),
      },
    });

    for (const operationalRegionId of normalizedOperationalRegionIds) {
      await tx.userOperationalRegionAccess.upsert({
        where: {
          userId_operationalRegionId: {
            userId,
            operationalRegionId,
          },
        },
        create: {
          id: randomUUID(),
          userId,
          operationalRegionId,
          accessRole: accessRole ?? null,
        },
        update: {
          accessRole: accessRole ?? undefined,
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
