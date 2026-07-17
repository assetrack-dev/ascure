import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { isQaActor } from '../common/authorization/qa-actor';
import { resolveCanReport } from '../common/authorization/reporting-actor';
import { resolveCanImport } from '../common/authorization/import-actor';
import { resolveMaintenanceOrgIds } from '../common/authorization/scope-context';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { JwtPayload } from './jwt-payload.interface';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';

const PASSWORD_SALT_ROUNDS = 10;
// "Always logged in" window for the mobile app. Long enough that field crew
// effectively never get logged out mid-deployment, with single-device rotation
// (mobileSessionId) acting as the real kill-switch. Admin web keeps the
// module-default 8h.
const MOBILE_TOKEN_TTL = '30d';

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

    // Mobile app opts into a single-device, long-lived ("always logged in")
    // session: stamp the user with a fresh session id, embed it in the token,
    // and give the token a 30-day TTL. Any subsequent login (a new phone, or a
    // re-login here) rotates mobileSessionId, so the previously-issued token
    // stops validating — enforcing one active phone per account. Admin-web
    // logins are unaffected and keep the default short-lived token.
    const isMobile = dto.client === 'mobile';
    const tokenPayload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    if (isMobile) {
      const sessionId = randomUUID();
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mobileSessionId: sessionId },
      });
      tokenPayload.client = 'mobile';
      tokenPayload.sid = sessionId;
    }

    const accessToken = await this.jwtService.signAsync(
      tokenPayload,
      isMobile ? { expiresIn: MOBILE_TOKEN_TTL } : undefined,
    );

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
    const canManageMaintenance = this.resolveCanManageMaintenance(requestUser);
    const canReviewSurvey = this.resolveCanReviewSurvey(requestUser);
    const canDeleteSurvey = this.resolveCanDeleteSurvey(requestUser);
    const canOverseeSubcontractors =
      await this.resolveCanOverseeSubcontractors(requestUser);

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
        canManageMaintenance,
        canReviewSurvey,
        canDeleteSurvey,
        canOverseeSubcontractors,
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
   * Whether this user is a MAIN_CONTRACTOR manager overseeing an active
   * subcontractor subtree — a MANAGER whose maintenance-org set spans more than
   * their own org (resolveMaintenanceOrgIds = own org + active contractor
   * descendants). Drives the admin-web's cross-org asset visibility + delete
   * affordances. Self-limiting: false for non-managers and for a manager with no
   * active subcontractors.
   */
  private async resolveCanOverseeSubcontractors(
    user: RequestUser,
  ): Promise<boolean> {
    if (user.role !== UserRole.MANAGER) {
      return false;
    }
    const orgIds = await resolveMaintenanceOrgIds(this.prisma, user);
    return orgIds.length > 1;
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

  /**
   * Server-provided authority to dispatch maintenance work for the company's
   * routed defect pool — assign a routed defect to one of the company's own
   * teams/technicians, or delegate it to a subcontractor (maintenance handoff
   * self-management). ADMIN (any) or MANAGER (own company). Exposed as a flag
   * because the admin console collapses MANAGER to VIEWER client-side; the
   * defect assign/delegate endpoints still enforce the org-scope server-side.
   */
  private resolveCanManageMaintenance(user: RequestUser): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
  }

  /**
   * Server-provided authority to review + approve a submitted survey (the
   * technician/supervisor → MANAGER → DC gate). ADMIN (any survey) or MANAGER
   * (own company — the lifecycle endpoint still enforces company scope, since a
   * manager can only see their own company's visits). Exposed as a flag because
   * the admin console collapses MANAGER to VIEWER client-side, so role alone
   * can't decide whether to show the manager approve / send-back controls.
   */
  private resolveCanReviewSurvey(user: RequestUser): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
  }

  private resolveCanDeleteSurvey(user: RequestUser): boolean {
    // Hard-deleting a survey / Pencawang is a manager+admin capability; the API
    // further scopes a MANAGER to their own company.
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
    const canManageMaintenance = this.resolveCanManageMaintenance(user);
    const canReviewSurvey = this.resolveCanReviewSurvey(user);
    const canDeleteSurvey = this.resolveCanDeleteSurvey(user);
    const canOverseeSubcontractors =
      await this.resolveCanOverseeSubcontractors(user);
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
      canManageMaintenance,
      canReviewSurvey,
      canDeleteSurvey,
      canOverseeSubcontractors,
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
