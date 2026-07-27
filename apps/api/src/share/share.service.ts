import { randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AssetsService } from '../assets/assets.service';
import { isQaActor } from '../common/authorization/qa-actor';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

/** Field-role (SUPERVISOR/TECHNICIAN) links live at most this many days. */
const FIELD_SHARE_MAX_DAYS = 7;

/** Origin of the public /s/[token] page (the admin-web deployment). */
function shareBaseUrl(): string {
  return (
    process.env.PUBLIC_SHARE_BASE_URL ?? 'https://admin.ascure.com.my'
  ).replace(/\/$/, '');
}

/**
 * Tokenized public "share this pole" links. Creating a link is an internal,
 * authenticated action (ADMIN / MANAGER / QA actor); resolving one is public —
 * the unguessable token is the credential, and it grants a read-only, LIVE
 * view of exactly ONE asset until the link expires.
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
  ) {}

  async createLink(user: RequestUser, assetId: string, expiresInDays: number) {
    // Two tiers of sharing:
    //  - office (ADMIN / MANAGER / QA actor): expiry as requested, up to 365d;
    //  - field (SUPERVISOR / TECHNICIAN, sharing from the mobile app): allowed
    //    — the link only shows data the crew captured themselves and every
    //    link records its creator — but capped at 7 days.
    // External viewers (VIEWER / CLIENT without QA) cannot mint links at all.
    const isOfficeSharer =
      user.role === UserRole.ADMIN ||
      user.role === UserRole.MANAGER ||
      (await isQaActor(this.prisma, user));
    const isFieldSharer =
      user.role === UserRole.SUPERVISOR || user.role === UserRole.TECHNICIAN;

    if (!isOfficeSharer && !isFieldSharer) {
      throw new ForbiddenException('Your role cannot share a pole.');
    }

    const effectiveDays = isOfficeSharer
      ? expiresInDays
      : Math.min(expiresInDays, FIELD_SHARE_MAX_DAYS);

    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, tenantId: user.tenantId },
      select: { id: true, tenantId: true },
    });
    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    // 192 random bits, base64url — the token IS the credential, so it must be
    // unguessable and URL-safe.
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + effectiveDays * 86_400_000);

    await this.prisma.assetShareLink.create({
      data: {
        tenantId: asset.tenantId,
        assetId: asset.id,
        token,
        createdByUserId: user.id,
        expiresAt,
      },
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      // The full public URL, so clients that don't serve the share page
      // themselves (the mobile app) don't need to know the admin-web origin.
      url: `${shareBaseUrl()}/s/${token}`,
    };
  }

  async resolve(token: string) {
    const link = await this.prisma.assetShareLink.findUnique({
      where: { token },
      select: { assetId: true, expiresAt: true, revokedAt: true },
    });

    // One message for missing / revoked / expired — a prober learns nothing
    // about which tokens ever existed.
    if (
      !link ||
      link.revokedAt !== null ||
      link.expiresAt.getTime() < Date.now()
    ) {
      throw new NotFoundException('This share link is invalid or has expired.');
    }

    const snapshot = await this.assetsService.buildSharedAssetSnapshot(
      link.assetId,
    );
    return { ...snapshot, shareExpiresAt: link.expiresAt.toISOString() };
  }
}
