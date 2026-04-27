import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSiteVisitDto } from './dto/create-site-visit.dto';
import { ListSiteVisitsQueryDto } from './dto/list-site-visits-query.dto';

@Injectable()
export class SiteVisitsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: RequestUser, dto: CreateSiteVisitDto) {
    const teamMembership = await this.prisma.teamMember.findFirst({
      where: {
        teamId: dto.teamId,
        userId: user.id,
        isActive: true,
        team: {
          tenantId: user.tenantId,
          isActive: true,
        },
      },
      include: {
        team: true,
      },
    });

    if (!teamMembership) {
      throw new ForbiddenException('You must belong to the selected team to create a site visit.');
    }

    const substation = await this.prisma.substation.findFirst({
      where: {
        id: dto.substationId,
        tenantId: user.tenantId,
        isActive: true,
      },
    });

    if (!substation) {
      throw new NotFoundException('Substation not found.');
    }

    const existingActiveVisit = await this.prisma.siteVisit.findFirst({
      where: {
        tenantId: user.tenantId,
        teamId: dto.teamId,
        substationId: dto.substationId,
        status: 'ACTIVE',
      },
      include: this.siteVisitInclude(),
    });

    if (existingActiveVisit) {
      throw new ConflictException('An active site visit already exists for this team at the selected substation.');
    }

    const activeTeamMembers = await this.prisma.teamMember.findMany({
      where: {
        teamId: dto.teamId,
        isActive: true,
        user: {
          isActive: true,
        },
      },
      select: {
        userId: true,
      },
    });

    return this.prisma.siteVisit.create({
      data: {
        tenantId: user.tenantId,
        teamId: dto.teamId,
        substationId: dto.substationId,
        createdByUserId: user.id,
        notes: dto.notes,
        users: {
          create: activeTeamMembers.map((member) => ({
            userId: member.userId,
          })),
        },
      },
      include: this.siteVisitInclude(),
    });
  }

  async list(user: RequestUser, query: ListSiteVisitsQueryDto) {
    return this.prisma.siteVisit.findMany({
      where: {
        tenantId: user.tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...this.accessScope(user),
      },
      include: this.siteVisitInclude(),
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  async getById(user: RequestUser, id: string) {
    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...this.accessScope(user),
      },
      include: {
        ...this.siteVisitInclude(),
        inspections: {
          include: {
            asset: {
              select: {
                id: true,
                assetCode: true,
                name: true,
              },
            },
            inspectionImages: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!siteVisit) {
      throw new NotFoundException('Site visit not found.');
    }

    return siteVisit;
  }

  private accessScope(user: RequestUser) {
    if (user.role === 'ADMIN') {
      return {};
    }

    return {
      team: {
        members: {
          some: {
            userId: user.id,
            isActive: true,
          },
        },
      },
    };
  }

  private siteVisitInclude(): Prisma.SiteVisitInclude {
    return {
      team: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      substation: {
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      users: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          },
        },
        orderBy: {
          joinedAt: 'asc',
        },
      },
    };
  }
}
