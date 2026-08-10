import { randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { AssetsService } from '../assets/assets.service';
import { isQaActor } from '../common/authorization/qa-actor';
import { buildScopeContext } from '../common/authorization/scope-context';
import { assetOversightWhere } from '../common/authorization/site-visit-scope';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

/** Field-role (SUPERVISOR/TECHNICIAN) links live at most this many days. */
const FIELD_SHARE_MAX_DAYS = 7;

/**
 * Client (TNB) links live at most this many days. They own the network, so
 * sharing a pole on it is theirs to do — but the link is PUBLIC and
 * UNAUTHENTICATED, so it gets a shorter leash than an office link's 365.
 */
const CLIENT_SHARE_MAX_DAYS = 30;

/** Origin of the public /s/[token] page (the admin-web deployment). */
function shareBaseUrl(): string {
  return (
    process.env.PUBLIC_SHARE_BASE_URL ?? 'https://admin.ascure.com.my'
  ).replace(/\/$/, '');
}

/**
 * Tokenized public "share this pole" links. Creating a link is an authenticated
 * action (office / field crew / the client on their own Mainheads); resolving
 * one is public — the unguessable token is the credential, and it grants a
 * read-only, LIVE view of exactly ONE asset until the link expires.
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
  ) {}

  async createLink(user: RequestUser, assetId: string, expiresInDays: number) {
    // Three tiers, which decide only HOW LONG the link lives. WHICH poles the
    // caller may share is a separate question, answered by `scopeWhere` below —
    // keep the two apart, because conflating them is how the old tenant-only
    // asset lookup went unnoticed.
    //  - office (ADMIN / MANAGER / QA actor): expiry as requested, up to 365d;
    //  - field (SUPERVISOR / TECHNICIAN, sharing from the mobile app): 7d;
    //  - client (TNB): the network OWNER sharing a pole on their own network, 30d.
    // A plain VIEWER still cannot mint links at all.
    const ctx = await buildScopeContext(this.prisma, user);
    const isOfficeSharer =
      user.role === UserRole.ADMIN ||
      user.role === UserRole.MANAGER ||
      (await isQaActor(this.prisma, user));
    const isFieldSharer =
      user.role === UserRole.SUPERVISOR || user.role === UserRole.TECHNICIAN;
    const isClientSharer = ctx.isClientViewer && !ctx.isAdmin;

    if (!isOfficeSharer && !isFieldSharer && !isClientSharer) {
      throw new ForbiddenException('Your role cannot share a pole.');
    }

    const effectiveDays = isOfficeSharer
      ? expiresInDays
      : Math.min(
          expiresInDays,
          isClientSharer ? CLIENT_SHARE_MAX_DAYS : FIELD_SHARE_MAX_DAYS,
        );

    // ⚠⚠ SCOPE THE ASSET, NOT JUST THE TENANT. A share link is PUBLIC, so
    // minting one is PUBLISHING — and this used to be tenant-scoped only, which
    // meant any authenticated non-admin could publish ANY pole in the tenant by
    // id, including another contractor's work. (The old comment claiming a field
    // link "only shows data the crew captured themselves" was aspirational; the
    // query never enforced it.)
    //
    // THE RULE: you may share what you may already SEE.
    //  - client  → poles in their assigned Mainheads. Their own scope, NOT the
    //    contractor's transitive one: a client's never-surveyed pole has no
    //    visit to reach it through, so the transitive rule would hide poles they
    //    can plainly see everywhere else in their view.
    //  - everyone else → the canonical asset read scope (ADMIN ⇒ {} = tenant;
    //    QA ⇒ their Mainheads; MANAGER ⇒ own company + subcontractor subtree;
    //    SUPERVISOR/TECHNICIAN ⇒ their own teams' work).
    // Fails closed in every branch — an empty scope matches nothing ⇒ 404.
    const scopeWhere: Prisma.AssetWhereInput = isClientSharer
      ? { substation: { mainheadId: { in: ctx.clientMainheadIds } } }
      : assetOversightWhere(user, ctx);

    const asset = await this.prisma.asset.findFirst({
      // AND rather than a spread: `scopeWhere` can itself constrain `substation`
      // (the client branch) or carry a top-level `OR` (the contractor branch),
      // and spreading would let one key silently replace the other.
      where: { AND: [scopeWhere, { id: assetId, tenantId: user.tenantId }] },
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
