import { randomUUID } from 'crypto';
import {
  DefectLifecycleStatus,
  DefectTimelineEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePackageOrganizationId } from '../maintenance-packages/package-routing.util';

/**
 * Maintenance handoff Phase 3 — defect release + auto-route.
 *
 * Under DEFECT_GOVERNANCE_MODE=RELEASE_ON_REPORT inspection and maintenance are
 * separate companies. A detected defect opens DORMANT (DETECTED) and is not yet
 * maintenance-ready; it RELEASES (→ VERIFIED). Routing to a maintenance company
 * comes from the visit's MaintenancePackage(s) — TNB's assignment of the PE
 * (docs/PLAN-maintenance-flow.md §5.1) — NOT from the Mainhead registry, which is
 * now only the default suggestion on TNB's assign screen. A visit normally has no
 * package yet at LAPORAN SELESAI (TNB assigns after the report), so its defects
 * release unrouted and are stamped when TNB assigns. Two triggers:
 *   - scope 'ALL'       : at LAPORAN SELESAI, release every still-dormant defect.
 *   - scope 'EMERGENCY' : at inspection submit, route emergency-flagged defects
 *                          immediately (they already open VERIFIED; here we only
 *                          stamp the routed org). Scoped to the submitting
 *                          inspection.
 *
 * Both are idempotent: re-running finds nothing left to release. ALL only touches
 * DETECTED/null (a one-way promotion). EMERGENCY only touches not-yet-routed
 * emergencies AND no-ops for any emergency with no package to route it to (it
 * waits in TNB's unrouted-emergency queue for manual assignment, already
 * VERIFIED) — so re-submits can't spuriously re-verify it.
 */

export type DefectReleaseScope = 'EMERGENCY' | 'ALL';

export interface VisitReleasePlan {
  /** Prisma ops to append to the caller's `$transaction([...])`, or run directly. */
  ops: Prisma.PrismaPromise<unknown>[];
  released: number;
  /** How many of the released defects were also stamped with a company. */
  routed: number;
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

/** The visit's packages (TNB's PE → company assignment). */
async function loadVisitPackages(prisma: PrismaService, siteVisitId: string) {
  return prisma.maintenancePackage.findMany({
    where: { siteVisitId },
    select: { category: true, maintenanceOrganizationId: true },
  });
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
  const packages = await loadVisitPackages(prisma, siteVisitId);

  const candidates = await prisma.defect.findMany({
    where: releaseTargetWhere(siteVisitId, options.scope, options.inspectionId),
    select: { id: true, lifecycleStatus: true, maintenanceCategory: true },
  });

  const withOrg = candidates.map((target) => ({
    ...target,
    organizationId: resolvePackageOrganizationId(
      packages,
      target.maintenanceCategory,
    ),
  }));

  // Emergency release exists ONLY to stamp a routed org. An emergency with no
  // package to route it to stays as it is (already VERIFIED, waiting in TNB's
  // unrouted queue) — skipping keeps re-submits from re-verifying it, since the
  // org stamp is what makes the EMERGENCY filter idempotent.
  const targets =
    options.scope === 'EMERGENCY'
      ? withOrg.filter((target) => target.organizationId !== null)
      : withOrg;

  if (targets.length === 0) {
    return { ops: [], released: 0, routed: 0 };
  }

  const baseData: Prisma.DefectUncheckedUpdateManyInput = {
    lifecycleStatus: DefectLifecycleStatus.VERIFIED,
    verifiedAt: options.now,
  };
  if (options.actorUserId) {
    baseData.verifiedByUserId = options.actorUserId;
  }

  // One write per destination (null = released unrouted). Unchecked form so the
  // FK scalar can be set directly (updateMany cannot use relation `connect`).
  const byOrg = new Map<string | null, string[]>();
  for (const target of targets) {
    const ids = byOrg.get(target.organizationId) ?? [];
    ids.push(target.id);
    byOrg.set(target.organizationId, ids);
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const [organizationId, ids] of byOrg) {
    ops.push(
      prisma.defect.updateMany({
        where: { id: { in: ids } },
        data: organizationId
          ? { ...baseData, maintenanceOrganizationId: organizationId }
          : baseData,
      }),
    );
  }

  const routed = targets.filter((target) => target.organizationId !== null).length;
  const base =
    options.scope === 'EMERGENCY'
      ? 'Emergency defect released'
      : 'Defect released at LAPORAN SELESAI';

  ops.push(
    prisma.defectTimelineEntry.createMany({
      data: targets.map((target) => ({
        id: randomUUID(),
        defectId: target.id,
        type: DefectTimelineEventType.DEFECT_VERIFIED,
        fromLifecycleStatus: target.lifecycleStatus,
        toLifecycleStatus: DefectLifecycleStatus.VERIFIED,
        comment: target.organizationId
          ? `${base} and routed to the Pencawang's maintenance package company.`
          : `${base}; awaiting TNB package assignment.`,
        createdByUserId: options.actorUserId ?? null,
        createdAt: options.now,
      })),
    }),
  );

  return { ops, released: targets.length, routed };
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
