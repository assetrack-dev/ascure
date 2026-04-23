import { Injectable } from '@nestjs/common';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
}
