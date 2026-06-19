import { randomUUID } from 'crypto';
import {
  DefectLifecycleStatus,
  DefectTimelineEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Maintenance handoff Phase 3 — defect release + auto-route.
 *
 * Under DEFECT_GOVERNANCE_MODE=RELEASE_ON_REPORT inspection and maintenance are
 * separate companies. A detected defect opens DORMANT (DETECTED) and is not yet
 * maintenance-ready; it RELEASES (→ VERIFIED) and is stamped with the MAINHEAD's
 * registered maintenance company so that company's users can see + claim it
 * cross-company (Phase 4). Two triggers:
 *   - scope 'ALL'       : at LAPORAN SELESAI, release every still-dormant defect.
 *   - scope 'EMERGENCY' : at inspection submit, route emergency-flagged defects
 *                          immediately (they already open VERIFIED; here we only
 *                          stamp the routed org). Scoped to the submitting
 *                          inspection.
 *
 * Both are idempotent: re-running finds nothing left to release. ALL only touches
 * DETECTED/null (a one-way promotion). EMERGENCY only touches not-yet-routed
 * emergencies AND no-ops entirely when the MAINHEAD has no maintenance company
 * registered (there is nothing to route, and the emergency is already VERIFIED +
 * team-visible) — so re-submits can't spuriously re-verify it.
 */

export type DefectReleaseScope = 'EMERGENCY' | 'ALL';

export interface VisitReleasePlan {
  /** Prisma ops to append to the caller's `$transaction([...])`, or run directly. */
  ops: Prisma.PrismaPromise<unknown>[];
  released: number;
  routedOrganizationId: string | null;
}

interface BuildReleaseOptions {
  scope: DefectReleaseScope;
  actorUserId?: string | null;
  now: Date;
  /**
   * Narrow the release to a single inspection (used by the emergency-at-submit
   * path so submitting one pole's inspection doesn't route another pole's
   * still-draft emergencies). When omitted, the whole site visit is targeted.
   */
  inspectionId?: string;
}

/** The maintenance company registered for the visit's MAINHEAD (Phase 2 registry). */
async function resolveMaintenanceOrganizationId(
  prisma: PrismaService,
  siteVisitId: string,
): Promise<string | null> {
  const visit = await prisma.siteVisit.findUnique({
    where: { id: siteVisitId },
    select: {
      mainheadRecord: { select: { maintenanceOrganizationId: true } },
    },
  });

  return visit?.mainheadRecord?.maintenanceOrganizationId ?? null;
}

function releaseTargetWhere(
  siteVisitId: string,
  scope: DefectReleaseScope,
  inspectionId?: string,
): Prisma.DefectWhereInput {
  const visitFilter: Prisma.DefectWhereInput = {
    inspectionItemResult: {
      isDefect: true,
      inspection: inspectionId ? { id: inspectionId } : { siteVisitId },
    },
  };

  if (scope === 'EMERGENCY') {
    // Emergencies open VERIFIED at submit; release = stamp the routed org once.
    return {
      ...visitFilter,
      isEmergency: true,
      maintenanceOrganizationId: null,
      lifecycleStatus: {
        in: [DefectLifecycleStatus.DETECTED, DefectLifecycleStatus.VERIFIED],
      },
    };
  }

  // ALL: the dormant pre-release set (DETECTED, or legacy null-lifecycle rows).
  return {
    ...visitFilter,
    OR: [
      { lifecycleStatus: DefectLifecycleStatus.DETECTED },
      { lifecycleStatus: null },
    ],
  };
}

/**
 * Build the release plan for a site visit's defects WITHOUT executing it, so the
 * caller can append `plan.ops` to an existing transaction (keeping the release
 * atomic with, e.g., the LAPORAN SELESAI status change).
 */
export async function buildVisitReleasePlan(
  prisma: PrismaService,
  siteVisitId: string,
  options: BuildReleaseOptions,
): Promise<VisitReleasePlan> {
  const routedOrganizationId = await resolveMaintenanceOrganizationId(
    prisma,
    siteVisitId,
  );

  // Emergency release exists ONLY to stamp the routed org. With no maintenance
  // company registered there is nothing to route (the emergency already opened
  // VERIFIED and is team-visible) — skip so re-submits can't re-verify it. The
  // org stamp is what makes the EMERGENCY filter idempotent, so without it we
  // must not write.
  if (options.scope === 'EMERGENCY' && !routedOrganizationId) {
    return { ops: [], released: 0, routedOrganizationId };
  }

  const targets = await prisma.defect.findMany({
    where: releaseTargetWhere(siteVisitId, options.scope, options.inspectionId),
    select: { id: true, lifecycleStatus: true },
  });

  if (targets.length === 0) {
    return { ops: [], released: 0, routedOrganizationId };
  }

  const ids = targets.map((target) => target.id);
  const routedSuffix = routedOrganizationId
    ? ' and routed to the registered maintenance company'
    : '';
  const comment =
    options.scope === 'EMERGENCY'
      ? `Emergency defect released${routedSuffix}.`
      : `Defect released at LAPORAN SELESAI${routedSuffix}.`;

  // Unchecked form so we can set the FK scalars directly (updateMany cannot use
  // relation `connect`).
  const updateData: Prisma.DefectUncheckedUpdateManyInput = {
    lifecycleStatus: DefectLifecycleStatus.VERIFIED,
    verifiedAt: options.now,
  };
  if (routedOrganizationId) {
    updateData.maintenanceOrganizationId = routedOrganizationId;
  }
  if (options.actorUserId) {
    updateData.verifiedByUserId = options.actorUserId;
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.defect.updateMany({
      where: { id: { in: ids } },
      data: updateData,
    }),
    prisma.defectTimelineEntry.createMany({
      data: targets.map((target) => ({
        id: randomUUID(),
        defectId: target.id,
        type: DefectTimelineEventType.DEFECT_VERIFIED,
        fromLifecycleStatus: target.lifecycleStatus,
        toLifecycleStatus: DefectLifecycleStatus.VERIFIED,
        comment,
        createdByUserId: options.actorUserId ?? null,
        createdAt: options.now,
      })),
    }),
  ];

  return { ops, released: targets.length, routedOrganizationId };
}

/**
 * Release + route a visit's defects in a standalone transaction. Used by the
 * emergency-at-submit path (which has no surrounding transition transaction).
 */
export async function releaseVisitDefects(
  prisma: PrismaService,
  siteVisitId: string,
  options: Omit<BuildReleaseOptions, 'now'>,
): Promise<VisitReleasePlan> {
  const plan = await buildVisitReleasePlan(prisma, siteVisitId, {
    ...options,
    now: new Date(),
  });

  if (plan.ops.length > 0) {
    await prisma.$transaction(plan.ops);
  }

  return plan;
}
