import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { isQaActor } from '../common/authorization/qa-actor';
import { resolveCanReport } from '../common/authorization/reporting-actor';
import { resolveCanImport } from '../common/authorization/import-actor';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import * as bcrypt from 'bcryptjs';

const PASSWORD_SALT_ROUNDS = 10;

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
        organizationId: true,
        isActive: true,
        mustChangePassword: true,
        passwordHash: true,
        organization: { select: { name: true } },
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
      organizationId: user.organizationId,
    };

    const [canGovernQa, canReport, canImport] = await Promise.all([
      this.resolveCanGovernQa(requestUser),
      resolveCanReport(this.usersService, requestUser),
      resolveCanImport(this.usersService, requestUser),
    ]);
    const canReassign = this.resolveCanReassign(requestUser);
    const canManageSupervisors = this.resolveCanManageSupervisors(requestUser);
    const canManageUsers = this.resolveCanManageUsers(requestUser);

    return {
      access_token: accessToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: user.organization?.name ?? null,
        mustChangePassword: user.mustChangePassword,
        canGovernQa,
        canReport,
        canImport,
        canReassign,
        canManageSupervisors,
        canManageUsers,
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

  /**
   * Server-provided authority to reassign a site visit to another team
   * (ADR 0002 §4). A coarse "can this role reassign at all" gate for the UI —
   * ADMIN / MANAGER / SUPERVISOR. The reassign endpoint still enforces the full
   * per-team / cross-org rules; this only decides whether to show the control.
   */
  private resolveCanReassign(user: RequestUser): boolean {
    return (
      user.role === UserRole.ADMIN ||
      user.role === UserRole.MANAGER ||
      user.role === UserRole.SUPERVISOR
    );
  }

  /**
   * Server-provided authority to manage a team's supervisor links (ADR 0002 §3)
   * — ADMIN (any team) or MANAGER (own company). Exposed as a flag because the
   * admin console collapses MANAGER to VIEWER client-side, so role alone can't
   * decide whether to show the supervisor-management control. The endpoints
   * still enforce the same-organization rule server-side.
   */
  private resolveCanManageSupervisors(user: RequestUser): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
  }

  /**
   * Server-provided authority to provision/manage users (create + reset
   * password + view their company's roster). ADMIN (all users) or MANAGER (own
   * company only). Exposed as a flag because the admin console collapses MANAGER
   * to VIEWER client-side; the /users endpoints still enforce the same-company
   * scope + role-whitelist server-side.
   */
  private resolveCanManageUsers(user: RequestUser): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
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
        organizationId: true,
        departmentId: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
        organization: { select: { name: true } },
      },
    });

    if (!currentUser) {
      throw new UnauthorizedException('Unauthorized.');
    }

    const [canGovernQa, canReport, canImport] = await Promise.all([
      this.resolveCanGovernQa(user),
      resolveCanReport(this.usersService, user),
      resolveCanImport(this.usersService, user),
    ]);
    const canReassign = this.resolveCanReassign(user);
    const canManageSupervisors = this.resolveCanManageSupervisors(user);
    const canManageUsers = this.resolveCanManageUsers(user);
    const { organization, ...currentUserFields } = currentUser;

    return {
      ...currentUserFields,
      organizationName: organization?.name ?? null,
      canGovernQa,
      canReport,
      canImport,
      canReassign,
      canManageSupervisors,
      canManageUsers,
    };
  }

  /**
   * Self-service password change. Verifies the current password, sets the new
   * hash, and clears the forced-change flag. Works WHILE mustChangePassword is
   * true — that's the whole point of the first-login flow. Returns the refreshed
   * /me payload so the client can drop the flag without a re-login.
   */
  async changeOwnPassword(user: RequestUser, dto: ChangeOwnPasswordDto) {
    const existing = await this.prisma.user.findFirst({
      where: { id: user.id, tenantId: user.tenantId, isActive: true },
      select: { id: true, passwordHash: true },
    });

    if (!existing) {
      throw new UnauthorizedException('Unauthorized.');
    }

    const matches = await bcrypt.compare(
      dto.currentPassword,
      existing.passwordHash,
    );

    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, PASSWORD_SALT_ROUNDS);

    await this.prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, mustChangePassword: false },
    });

    return this.me(user);
  }
}
