import { randomUUID } from 'crypto';
import {
  DefectLifecycleStatus,
  DefectStatus,
  DefectTimelineEventType,
  MaintenanceCategory,
  OrganizationType,
  Prisma,
} from '@prisma/client';

/**
 * Maintenance packages → Defect.maintenanceOrganizationId
 * (docs/PLAN-maintenance-flow.md §5.1).
 *
 * TNB hands a surveyed PE (one SiteVisit) to a maintenance company, either whole
 * or per work type. The routing stamp on each Kejanggalan is what every
 * contractor-side scope (defectAccessScope, the workspace, delegate) already
 * keys on, so a package only has to keep that stamp in sync.
 *
 * Owner rules (2026-09-26):
 *  - Reassigning a started PE moves ONLY the Kejanggalan with no repair evidence
 *    yet; evidenced / completed / closed ones stay credited to the original
 *    company.
 *  - A company's delegation to its own subcontractor is respected: a defect
 *    already routed anywhere inside the target company's contractor subtree is
 *    left where it is.
 */

type PackageShape = {
  category: MaintenanceCategory | null;
  maintenanceOrganizationId: string;
};

/** Released = past the dormant pre-report state and not thrown out as invalid. */
export const RELEASED_DEFECT_WHERE: Prisma.DefectWhereInput = {
  OR: [
    { lifecycleStatus: null },
    {
      lifecycleStatus: {
        notIn: [DefectLifecycleStatus.DETECTED, DefectLifecycleStatus.REJECTED],
      },
    },
  ],
};

/** Evidence the inspector attached at declare-emergency time is NOT repair work. */
export const REPAIR_EVIDENCE_WHERE: Prisma.DefectEvidenceImageWhereInput = {
  evidenceType: { not: 'EMERGENCY' },
};

const FINISHED_LIFECYCLES: ReadonlySet<DefectLifecycleStatus> = new Set([
  DefectLifecycleStatus.COMPLETED,
  DefectLifecycleStatus.VERIFICATION_PENDING,
  DefectLifecycleStatus.CLOSED,
]);

const FINISHED_STATUSES: ReadonlySet<DefectStatus> = new Set([
  DefectStatus.RESOLVED,
  DefectStatus.CLOSED,
]);

/** The company a defect of `category` belongs to under the visit's packages. */
export function resolvePackageOrganizationId(
  packages: PackageShape[],
  category: MaintenanceCategory | null,
): string | null {
  const effective = category ?? MaintenanceCategory.SELENGGARAAN;
  const lane = packages.find((pkg) => pkg.category === effective);
  if (lane) {
    return lane.maintenanceOrganizationId;
  }
  return (
    packages.find((pkg) => pkg.category === null)?.maintenanceOrganizationId ??
    null
  );
}

/** `rootId` plus every active contractor org below it (loop-safe). */
async function contractorSubtree(
  tx: Prisma.TransactionClient,
  rootId: string,
): Promise<Set<string>> {
  const subtree = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await tx.organization.findMany({
      where: {
        parentOrganizationId: { in: frontier },
        isActive: true,
        type: {
          in: [OrganizationType.MAIN_CONTRACTOR, OrganizationType.SUBCONTRACTOR],
        },
      },
      select: { id: true },
    });
    frontier = children.map((child) => child.id).filter((id) => !subtree.has(id));
    frontier.forEach((id) => subtree.add(id));
  }
  return subtree;
}

export interface RoutingResult {
  /** Newly stamped (were unrouted). */
  routed: number;
  /** Moved from another company (work state reset). */
  moved: number;
  /** Left with their current company because work already started / finished. */
  kept: number;
}

/**
 * Re-sync every released Kejanggalan of `siteVisitId` with the visit's current
 * packages. Idempotent: a second run with unchanged packages changes nothing.
 * Must run inside the caller's transaction, after the package rows are written.
 */
export async function applyPackageRouting(
  tx: Prisma.TransactionClient,
  siteVisitId: string,
  options: {
    actorUserId: string;
    now: Date;
    /** Timeline wording, e.g. "Pencawang package assigned by TNB". */
    reason: string;
  },
): Promise<RoutingResult> {
  const packages = await tx.maintenancePackage.findMany({
    where: { siteVisitId },
    select: { category: true, maintenanceOrganizationId: true },
  });

  const defects = await tx.defect.findMany({
    where: {
      inspectionItemResult: { isDefect: true, inspection: { siteVisitId } },
      ...RELEASED_DEFECT_WHERE,
    },
    select: {
      id: true,
      maintenanceCategory: true,
      maintenanceOrganizationId: true,
      lifecycleStatus: true,
      status: true,
      _count: { select: { evidenceImages: { where: REPAIR_EVIDENCE_WHERE } } },
    },
  });

  const subtrees = new Map<string, Set<string>>();
  const subtreeOf = async (orgId: string) => {
    let subtree = subtrees.get(orgId);
    if (!subtree) {
      subtree = await contractorSubtree(tx, orgId);
      subtrees.set(orgId, subtree);
    }
    return subtree;
  };

  const orgNames = new Map(
    (
      await tx.organization.findMany({
        where: {
          id: { in: [...new Set(packages.map((pkg) => pkg.maintenanceOrganizationId))] },
        },
        select: { id: true, name: true },
      })
    ).map((org) => [org.id, org.name]),
  );

  const result: RoutingResult = { routed: 0, moved: 0, kept: 0 };
  const timeline: Prisma.DefectTimelineEntryCreateManyInput[] = [];
  // Batched writes, keyed by target org ('' = withdrawn → null).
  const stampIds = new Map<string, string[]>();
  const moveIds = new Map<string, { verified: string[]; legacy: string[] }>();

  for (const defect of defects) {
    const target = resolvePackageOrganizationId(packages, defect.maintenanceCategory);
    const current = defect.maintenanceOrganizationId;

    if (target === null && current === null) {
      continue;
    }
    if (target && current && (await subtreeOf(target)).has(current)) {
      continue;
    }

    const finished =
      (defect.lifecycleStatus !== null &&
        FINISHED_LIFECYCLES.has(defect.lifecycleStatus)) ||
      FINISHED_STATUSES.has(defect.status);
    if (finished) {
      result.kept += 1;
      continue;
    }

    const targetLabel = target ? orgNames.get(target) ?? 'maintenance company' : null;

    if (current === null && target) {
      const ids = stampIds.get(target) ?? [];
      ids.push(defect.id);
      stampIds.set(target, ids);
      result.routed += 1;
      timeline.push({
        id: randomUUID(),
        defectId: defect.id,
        type: DefectTimelineEventType.ASSIGNMENT_CHANGED,
        fromLifecycleStatus: defect.lifecycleStatus,
        toLifecycleStatus: defect.lifecycleStatus,
        comment: `${options.reason}: routed to ${targetLabel}.`,
        createdByUserId: options.actorUserId,
        createdAt: options.now,
      });
      continue;
    }

    if (defect._count.evidenceImages > 0) {
      result.kept += 1;
      continue;
    }

    const toLifecycle =
      defect.lifecycleStatus === null
        ? null
        : DefectLifecycleStatus.VERIFIED;
    const bucket = moveIds.get(target ?? '') ?? { verified: [], legacy: [] };
    (toLifecycle === null ? bucket.legacy : bucket.verified).push(defect.id);
    moveIds.set(target ?? '', bucket);
    result.moved += 1;
    timeline.push({
      id: randomUUID(),
      defectId: defect.id,
      type: DefectTimelineEventType.ASSIGNMENT_CHANGED,
      fromLifecycleStatus: defect.lifecycleStatus,
      toLifecycleStatus: toLifecycle,
      comment: target
        ? `${options.reason}: moved to ${targetLabel}.`
        : `${options.reason}: package withdrawn, returned to TNB.`,
      createdByUserId: options.actorUserId,
      createdAt: options.now,
    });
  }

  for (const [orgId, ids] of stampIds) {
    await tx.defect.updateMany({
      where: { id: { in: ids } },
      data: { maintenanceOrganizationId: orgId },
    });
  }

  for (const [orgKey, bucket] of moveIds) {
    // Same clean slate as delegateDefect: the previous company's in-flight
    // assignment and notes must not follow the work to its new owner.
    const reset: Prisma.DefectUncheckedUpdateManyInput = {
      maintenanceOrganizationId: orgKey || null,
      assignedUserId: null,
      assignedToUserId: null,
      assignedTeamId: null,
      assignedToTeamId: null,
      assignedAt: null,
      status: DefectStatus.OPEN,
      dueDate: null,
      actionRemark: null,
      maintenanceNotes: null,
      resolutionOutcome: null,
      resolvedAt: null,
      maintainedByUserId: null,
      maintainedAt: null,
    };
    if (bucket.verified.length > 0) {
      await tx.defect.updateMany({
        where: { id: { in: bucket.verified } },
        data: { ...reset, lifecycleStatus: DefectLifecycleStatus.VERIFIED },
      });
    }
    if (bucket.legacy.length > 0) {
      await tx.defect.updateMany({
        where: { id: { in: bucket.legacy } },
        data: reset,
      });
    }
  }

  if (timeline.length > 0) {
    await tx.defectTimelineEntry.createMany({ data: timeline });
  }

  return result;
}
