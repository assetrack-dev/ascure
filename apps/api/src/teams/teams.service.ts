import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, UserRole } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto, UpdateTeamDto, UpdateTeamStatusDto } from './dto/manage-team.dto';
import { SetTeamSupervisorsDto } from './dto/team-supervisors.dto';

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

const SUPERVISOR_USER_SELECT = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  name: true,
  email: true,
  role: true,
});

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: RequestUser) {
    // ADMIN sees every team in the tenant (incl. inactive). A MANAGER manages
    // only their own company, so they see only their company's teams (incl.
    // inactive, so they can reactivate); a manager with no company sees nothing.
    // Everyone else (picker consumers) gets the active set, unchanged.
    let scope: Prisma.TeamWhereInput;
    if (user.role === UserRole.ADMIN) {
      scope = {};
    } else if (user.role === UserRole.MANAGER) {
      if (!user.organizationId) {
        return Promise.resolve([]);
      }
      scope = { organizationId: user.organizationId };
    } else {
      scope = { isActive: true };
    }

    return this.prisma.team.findMany({
      where: {
        tenantId: user.tenantId,
        ...scope,
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
    // A MANAGER can only create teams inside their own company; ADMIN is
    // unrestricted. This both fills in the org for a manager (their form has no
    // org picker) and rejects any attempt to plant a team in another company.
    const organizationId = this.resolveManagedOrganizationId(
      user,
      dto.organizationId,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertTeamCodeAvailable(tx, user.tenantId, dto.code);
        const operationalLinks = await this.resolveOperationalLinks(tx, {
          organizationId,
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

        // A MANAGER may only edit teams in their own company, and may not move a
        // team out of it. ADMIN is unrestricted.
        this.assertManagerOrgScope(user, existingTeam.organizationId);
        // Clamp the target org and USE the clamped value (don't discard it): for
        // a MANAGER, resolveManagedOrganizationId(null) returns their own org, so
        // an explicit `organizationId: null` can never orphan/move the team out of
        // their company. (A bare resolveManagedOrganizationId call whose result is
        // thrown away would let `{ organizationId: null }` slip past — null is not
        // "another org" — and re-derive the org from a foreign branch/mainhead.)
        const targetOrganizationId =
          dto.organizationId === undefined
            ? existingTeam.organizationId
            : this.resolveManagedOrganizationId(user, dto.organizationId);

        if (dto.code !== undefined) {
          await this.assertTeamCodeAvailable(tx, user.tenantId, dto.code, id);
        }

        const shouldResolveOperationalLinks =
          dto.organizationId !== undefined ||
          dto.branchId !== undefined ||
          dto.mainheadId !== undefined;
        const operationalLinks = shouldResolveOperationalLinks
          ? await this.resolveOperationalLinks(tx, {
              organizationId: targetOrganizationId,
              branchId:
                dto.branchId === undefined ? existingTeam.branchId : dto.branchId,
              mainheadId:
                dto.mainheadId === undefined
                  ? existingTeam.mainheadId
                  : dto.mainheadId,
            })
          : null;

        // Belt-and-suspenders: a branch/mainhead can re-derive the org inside
        // resolveOperationalLinks, so re-assert the final org is still in the
        // manager's company (ADMIN unrestricted).
        if (operationalLinks) {
          this.assertManagerOrgScope(user, operationalLinks.organizationId);
        }

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
        organizationId: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    // A MANAGER may only activate/deactivate teams in their own company.
    this.assertManagerOrgScope(user, team.organizationId);

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

  /**
   * List the supervisors assigned to a team plus the eligible candidate pool
   * (ADR 0002 §3). One call so the admin UI can render the picker without a
   * second round-trip.
   */
  async listSupervisors(user: RequestUser, teamId: string) {
    const team = await this.assertManageableTeam(user, teamId);
    return this.buildSupervisorView(user, team);
  }

  /**
   * Set the full supervisor set for a team — links absent from the list are
   * removed, present ones created (ADR 0002 §3). The supervisor↔team link is
   * what grants `accessScope` visibility and supervisor reassign authority, so
   * without this nothing can populate it but raw DB writes.
   */
  async setSupervisors(
    user: RequestUser,
    teamId: string,
    dto: SetTeamSupervisorsDto,
  ) {
    const team = await this.assertManageableTeam(user, teamId);
    const supervisorUserIds = this.normalizeIdList(dto.supervisorUserIds);

    if (supervisorUserIds.length > 0) {
      await this.assertEligibleSupervisors(user, team, supervisorUserIds);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.teamSupervisor.deleteMany({
        where: {
          teamId: team.id,
          ...(supervisorUserIds.length > 0
            ? { supervisorUserId: { notIn: supervisorUserIds } }
            : {}),
        },
      });

      for (const supervisorUserId of supervisorUserIds) {
        await tx.teamSupervisor.upsert({
          where: {
            teamId_supervisorUserId: { teamId: team.id, supervisorUserId },
          },
          create: { teamId: team.id, supervisorUserId, isActive: true },
          update: { isActive: true },
        });
      }
    });

    return this.buildSupervisorView(user, team);
  }

  /**
   * Resolve the organization a team create/move may target for the actor. ADMIN
   * is unrestricted (returns the requested org as-is). A MANAGER is locked to
   * their own company: their form carries no org picker, so a missing/own org is
   * filled in, and any other org is rejected (they can't plant or move a team
   * into another company). Mirrors users.service resolveCreateScope.
   */
  private resolveManagedOrganizationId(
    user: RequestUser,
    requestedOrganizationId: string | null | undefined,
  ): string | null | undefined {
    if (user.role === UserRole.ADMIN) {
      return requestedOrganizationId;
    }

    if (!user.organizationId) {
      throw new ForbiddenException(
        'Your account is not linked to a company; ask an administrator to assign one before managing teams.',
      );
    }

    if (
      requestedOrganizationId != null &&
      requestedOrganizationId !== user.organizationId
    ) {
      throw new ForbiddenException(
        'You can only create or move teams within your own company.',
      );
    }

    return user.organizationId;
  }

  /**
   * Guard that a non-ADMIN actor (a MANAGER) is operating on a team in their own
   * company. ADMIN passes unconditionally.
   */
  private assertManagerOrgScope(
    user: RequestUser,
    teamOrganizationId: string | null,
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (!user.organizationId || teamOrganizationId !== user.organizationId) {
      throw new ForbiddenException(
        'You can only manage teams in your own company.',
      );
    }
  }

  /**
   * Resolve a team the actor may manage supervisors for: ADMIN over any team in
   * their tenant, MANAGER only over teams in their own organization (ADR 0002
   * §3 — a manager governs their own company).
   */
  private async assertManageableTeam(user: RequestUser, teamId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, tenantId: user.tenantId },
      select: { id: true, name: true, organizationId: true },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (user.role === UserRole.ADMIN) {
      return team;
    }

    if (
      user.role === UserRole.MANAGER &&
      user.organizationId &&
      team.organizationId === user.organizationId
    ) {
      return team;
    }

    throw new ForbiddenException(
      'You are not allowed to manage supervisors for this team.',
    );
  }

  /**
   * Eligible supervisors are active SUPERVISOR-role users in the same tenant
   * and — when the team belongs to an organization — the same company (ADR 0002:
   * a supervisor's teams are a subset of their own company). Validates the whole
   * submitted set in one count.
   */
  private async assertEligibleSupervisors(
    user: RequestUser,
    team: { organizationId: string | null },
    supervisorUserIds: string[],
  ) {
    const eligibleCount = await this.prisma.user.count({
      where: {
        id: { in: supervisorUserIds },
        tenantId: user.tenantId,
        isActive: true,
        role: UserRole.SUPERVISOR,
        ...(team.organizationId ? { organizationId: team.organizationId } : {}),
      },
    });

    if (eligibleCount !== supervisorUserIds.length) {
      throw new BadRequestException(
        team.organizationId
          ? 'Every supervisor must be an active supervisor in the same organization as the team.'
          : 'Every supervisor must be an active supervisor in the same tenant.',
      );
    }
  }

  private async buildSupervisorView(
    user: RequestUser,
    team: { id: string; name: string; organizationId: string | null },
  ) {
    const [links, candidates] = await Promise.all([
      this.prisma.teamSupervisor.findMany({
        where: { teamId: team.id, isActive: true },
        select: { supervisor: { select: SUPERVISOR_USER_SELECT } },
        orderBy: { supervisor: { name: 'asc' } },
      }),
      this.prisma.user.findMany({
        where: {
          tenantId: user.tenantId,
          isActive: true,
          role: UserRole.SUPERVISOR,
          ...(team.organizationId ? { organizationId: team.organizationId } : {}),
        },
        select: SUPERVISOR_USER_SELECT,
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      teamId: team.id,
      teamName: team.name,
      supervisors: links.map((link) => link.supervisor),
      candidates,
    };
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
