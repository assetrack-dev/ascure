import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

        return tx.user.create({
          data: {
            tenantId: user.tenantId,
            departmentId: dto.departmentId ?? null,
            email: dto.email,
            name: dto.name,
            passwordHash,
            role: dto.role,
            isActive: dto.isActive ?? true,
          },
          select: this.userSelect(),
        });
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

        if (Object.keys(data).length === 0) {
          throw new BadRequestException(
            'At least one editable user field must be provided.',
          );
        }

        return tx.user.update({
          where: {
            id,
          },
          data,
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

  private userSelect() {
    return {
      id: true,
      tenantId: true,
      departmentId: true,
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
    } satisfies Prisma.UserSelect;
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
