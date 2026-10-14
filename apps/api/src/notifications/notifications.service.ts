import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ClientRank,
  NotificationType,
  OrganizationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import * as webpush from 'web-push';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

/** Events inside this window fold into one bell row ("12 repairs"). */
const GROUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * A group's phone push waits this long (default 2 min; env PUSH_GROUP_DELAY_MS)
 * after its first (or next) event, so a crew submitting a Pencawang's repairs one
 * by one produces ONE push carrying the running count — not a buzz per pole.
 * Later events in the same window re-send under the same `tag`, which silently
 * replaces the phone notification.
 */
const DEFAULT_PUSH_DELAY_MS = 2 * 60 * 1000;

const LIST_LIMIT_MAX = 50;

export type RepairSubmittedEvent = {
  tenantId: string;
  actorUserId: string;
  siteVisitId: string;
  maintenanceOrganizationId: string;
};

type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

/**
 * Plan §19 (N56): the console 🔔 + Web Push.
 *
 * v1 event = REPAIRS SUBMITTED: a maintenance crew marks a routed Kejanggalan
 * done (DefectsService.completeMaintenance) → it waits for TNB verification.
 * Recipients: the TNB Supervisors handling that company whose TNB org owns the
 * survey's Mainhead; none → that Mainhead's TNB Foreman / Technician. Grouped per
 * Pencawang (site visit) + company within {@link GROUP_WINDOW_MS}.
 *
 * Push is OPTIONAL: without VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the env it is
 * off and the bell still works. Push timers live in memory — an API restart
 * drops a pending push, never the bell row.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly pushTimers = new Map<string, NodeJS.Timeout>();
  private readonly pushEnabled: boolean;
  private readonly publicKey: string | null;
  private readonly pushDelayMs: number;

  // ⚠ Read env HERE, not at module scope: this file is imported before
  // ConfigModule loads .env, so a module-level read sees nothing.
  constructor(private readonly prisma: PrismaService) {
    const delay = Number(process.env.PUSH_GROUP_DELAY_MS);
    this.pushDelayMs = Number.isFinite(delay) && delay > 0 ? delay : DEFAULT_PUSH_DELAY_MS;
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    this.pushEnabled = Boolean(publicKey && privateKey);
    this.publicKey = this.pushEnabled ? publicKey! : null;
    if (this.pushEnabled) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@ascure.com.my',
        publicKey!,
        privateKey!,
      );
    }
  }

  // ── Bell ───────────────────────────────────────────────────────────────────

  async list(user: RequestUser, limit = 30) {
    const take = Math.min(Math.max(limit, 1), LIST_LIMIT_MAX);
    const [unread, items] = await Promise.all([
      this.unreadCount(user),
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { lastEventAt: 'desc' },
        take,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          url: true,
          count: true,
          readAt: true,
          lastEventAt: true,
        },
      }),
    ]);
    return {
      unread,
      items: items.map((item) => ({
        ...item,
        readAt: item.readAt?.toISOString() ?? null,
        lastEventAt: item.lastEventAt.toISOString(),
      })),
    };
  }

  unreadCount(user: RequestUser) {
    return this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
  }

  async markRead(user: RequestUser, id: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.prisma.notification.count({ where: { id, userId: user.id } });
      if (!exists) throw new NotFoundException('Notification not found.');
    }
    return { unread: await this.unreadCount(user) };
  }

  async markAllRead(user: RequestUser) {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { unread: 0 };
  }

  // ── Push subscriptions ─────────────────────────────────────────────────────

  pushConfig() {
    return { enabled: this.pushEnabled, publicKey: this.publicKey };
  }

  async subscribe(user: RequestUser, input: PushSubscriptionInput) {
    // Upsert by endpoint: a shared phone that signs in as someone else moves
    // its subscription to the new user instead of pushing to the old one.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        tenantId: user.tenantId,
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
      update: {
        tenantId: user.tenantId,
        userId: user.id,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
    return { subscribed: true };
  }

  async unsubscribe(user: RequestUser, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: user.id },
    });
    return { subscribed: false };
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  /**
   * A routed repair was submitted for TNB verification. Never throws: a
   * notification failure must not fail the crew's submission.
   */
  async repairSubmitted(event: RepairSubmittedEvent): Promise<void> {
    try {
      await this.recordRepairSubmitted(event);
    } catch (error) {
      this.logger.warn(`repairSubmitted notification failed: ${String(error)}`);
    }
  }

  private async recordRepairSubmitted(event: RepairSubmittedEvent) {
    const [visit, company] = await Promise.all([
      this.prisma.siteVisit.findUnique({
        where: { id: event.siteVisitId },
        select: {
          mainheadId: true,
          pencawangName: true,
          substation: { select: { name: true, code: true } },
        },
      }),
      this.prisma.organization.findUnique({
        where: { id: event.maintenanceOrganizationId },
        select: { name: true },
      }),
    ]);
    // Repair Verification scopes TNB by the VISIT's Mainhead — without one,
    // nobody at TNB could act on it, so there is nobody to tell.
    if (!visit?.mainheadId) {
      return;
    }
    const recipientIds = (
      await this.resolveRepairRecipients(event, visit.mainheadId)
    ).filter((id) => id !== event.actorUserId);
    if (recipientIds.length === 0) {
      return;
    }

    // Same precedence as the Repair Verification group label.
    const pencawang =
      visit.pencawangName || visit.substation?.name || visit.substation?.code || 'a Pencawang';
    const companyName = company?.name ?? 'A company';
    const groupKey = `REPAIRS_SUBMITTED:${event.siteVisitId}:${event.maintenanceOrganizationId}`;
    const url =
      `/maintenance-verification?siteVisitId=${event.siteVisitId}` +
      `&organizationId=${event.maintenanceOrganizationId}`;
    const now = new Date();
    const text = (count: number) => ({
      title: `${companyName} submitted ${count} repair${count === 1 ? '' : 's'}`,
      body: `${pencawang} · waiting for verification`,
    });

    for (const userId of recipientIds) {
      const open = await this.prisma.notification.findFirst({
        where: {
          userId,
          groupKey,
          windowStartAt: { gte: new Date(now.getTime() - GROUP_WINDOW_MS) },
        },
        orderBy: { windowStartAt: 'desc' },
        select: { id: true, count: true },
      });
      const row = open
        ? await this.prisma.notification.update({
            where: { id: open.id },
            data: { count: open.count + 1, ...text(open.count + 1), lastEventAt: now, readAt: null },
            select: { id: true },
          })
        : await this.prisma.notification.create({
            data: {
              tenantId: event.tenantId,
              userId,
              type: NotificationType.REPAIRS_SUBMITTED,
              groupKey,
              url,
              count: 1,
              ...text(1),
              windowStartAt: now,
              lastEventAt: now,
            },
            select: { id: true },
          });
      this.schedulePush(row.id);
    }
  }

  /**
   * The company's TNB Supervisors (rank SUPERVISOR, the company in its
   * ClientCompanyAccess, its TNB org owning the Mainhead) — or, when there is
   * none, that Mainhead's TNB Foreman / Technician.
   */
  private async resolveRepairRecipients(
    event: RepairSubmittedEvent,
    mainheadId: string,
  ): Promise<string[]> {
    const tnbOwnsMainhead: Prisma.OrganizationWhereInput = {
      type: OrganizationType.TNB,
      isActive: true,
      mainheadAssignments: {
        some: { mainheadId, isActive: true, mainhead: { isActive: true } },
      },
    };
    const base: Prisma.UserWhereInput = {
      tenantId: event.tenantId,
      isActive: true,
      role: UserRole.CLIENT,
      organization: tnbOwnsMainhead,
    };
    const supervisors = await this.prisma.user.findMany({
      where: {
        ...base,
        clientRank: ClientRank.SUPERVISOR,
        clientCompanyAccesses: {
          some: { organizationId: event.maintenanceOrganizationId, organization: { isActive: true } },
        },
      },
      select: { id: true },
    });
    if (supervisors.length > 0) {
      return supervisors.map((row) => row.id);
    }
    const fallback = await this.prisma.user.findMany({
      where: { ...base, clientRank: { in: [ClientRank.FOREMAN, ClientRank.TECHNICIAN] } },
      select: { id: true },
    });
    return fallback.map((row) => row.id);
  }

  // ── Push delivery ──────────────────────────────────────────────────────────

  private schedulePush(notificationId: string) {
    if (!this.pushEnabled || this.pushTimers.has(notificationId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.pushTimers.delete(notificationId);
      void this.sendPush(notificationId);
    }, this.pushDelayMs);
    timer.unref?.();
    this.pushTimers.set(notificationId, timer);
  }

  private async sendPush(notificationId: string) {
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
        select: {
          id: true,
          userId: true,
          title: true,
          body: true,
          url: true,
          groupKey: true,
          count: true,
          readAt: true,
        },
      });
      if (!notification || notification.readAt) {
        return; // Already seen in the console — don't buzz the phone.
      }
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: { userId: notification.userId },
      });
      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        url: notification.url,
        tag: notification.groupKey,
        count: notification.count,
        notificationId: notification.id,
      });
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
              { TTL: 60 * 60 },
            );
            await this.prisma.pushSubscription.update({
              where: { id: sub.id },
              data: { lastSuccessAt: new Date() },
            });
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
              // The browser dropped this subscription (uninstalled / permission revoked).
              await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
            } else {
              this.logger.warn(`push to ${sub.id} failed: ${status ?? String(error)}`);
            }
          }
        }),
      );
    } catch (error) {
      this.logger.warn(`sendPush ${notificationId} failed: ${String(error)}`);
    }
  }
}
