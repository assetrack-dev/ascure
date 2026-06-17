import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ||
        'change-me-for-local-development',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        mobileSessionId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Unauthorized.');
    }

    // Single-device enforcement for mobile sessions: the token's session id
    // must still match the user's active mobile session. A mismatch means the
    // account was signed in on another phone after this token was issued (which
    // rotated mobileSessionId), so this older device is signed out.
    if (payload.client === 'mobile' && payload.sid !== user.mobileSessionId) {
      throw new UnauthorizedException(
        'Signed out: this account was signed in on another device.',
      );
    }

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
    };
  }
}
