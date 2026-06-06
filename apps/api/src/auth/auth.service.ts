import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { isQaActor } from '../common/authorization/qa-actor';
import { resolveCanReport } from '../common/authorization/reporting-actor';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: {
        id: true,
        tenantId: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    const requestUser: RequestUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const [canGovernQa, canReport] = await Promise.all([
      this.resolveCanGovernQa(requestUser),
      resolveCanReport(this.usersService, requestUser),
    ]);

    return {
      access_token: accessToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role,
        canGovernQa,
        canReport,
      },
    };
  }

  /**
   * Mirrors the server-side authority enforced for defect QA governance
   * (verify/reject/closure): the action runs `assertCanMutate` (blocks
   * VIEWER/CLIENT) AND `assertCanGovernQa` (ADMIN or an ASCURE QA actor with an
   * active QA_VALIDATION capability). Exposing this as a flag lets the admin UI
   * enable QA controls exactly when the API would authorize them, instead of
   * guessing from role. It does NOT change/weaken any API authorization.
   */
  private async resolveCanGovernQa(user: RequestUser): Promise<boolean> {
    if (user.role === UserRole.VIEWER || user.role === UserRole.CLIENT) {
      return false;
    }

    if (user.role === UserRole.ADMIN) {
      return true;
    }

    return isQaActor(this.prisma, user);
  }

  async me(user: RequestUser) {
    const currentUser = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        name: true,
        role: true,
        departmentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!currentUser) {
      throw new UnauthorizedException('Unauthorized.');
    }

    const [canGovernQa, canReport] = await Promise.all([
      this.resolveCanGovernQa(user),
      resolveCanReport(this.usersService, user),
    ]);

    return {
      ...currentUser,
      canGovernQa,
      canReport,
    };
  }
}
