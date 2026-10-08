import {
  DefectLifecycleStatus,
  DefectStatus,
  MaintenanceCategory,
  Prisma,
} from '@prisma/client';

/**
 * Repair view of the Asset Map (maintenance company Manager / Supervisor).
 *
 * A maintenance company surveyed nothing, so the survey-based map scope shows it
 * nothing. Its work is the Kejanggalan routed to it (Defect.maintenanceOrganizationId),
 * so the map also shows every pole of each Pencawang carrying such work — the
 * company's own poles coloured by repair stage, the rest grey for route context.
 */
export interface RepairScope {
  /** The company (a Manager: plus its subcontractors) whose routed work counts. */
  orgIds: string[];
  /** Pencawang carrying any of that work (package, pole split or routed defect). */
  substationIds: string[];
}

/** Repair stage of one Kejanggalan — same buckets as the Maintenance Packages board. */
export type RepairStage = 'todo' | 'inProgress' | 'awaiting' | 'closed';

export function repairStage(defect: {
  lifecycleStatus: DefectLifecycleStatus | null;
  status: DefectStatus;
}): RepairStage {
  if (
    defect.lifecycleStatus === DefectLifecycleStatus.CLOSED ||
    defect.status === DefectStatus.RESOLVED ||
    defect.status === DefectStatus.CLOSED
  ) {
    return 'closed';
  }
  if (
    defect.lifecycleStatus === DefectLifecycleStatus.COMPLETED ||
    defect.lifecycleStatus === DefectLifecycleStatus.VERIFICATION_PENDING
  ) {
    return 'awaiting';
  }
  if (defect.lifecycleStatus === DefectLifecycleStatus.IN_PROGRESS) {
    return 'inProgress';
  }
  return 'todo';
}

/** Per-pole tally of the caller's own routed Kejanggalan. */
export interface PoleRepairSummary {
  total: number;
  todo: number;
  inProgress: number;
  awaiting: number;
  closed: number;
  /** Open (not closed / awaiting) emergencies. */
  emergency: number;
  categories: MaintenanceCategory[];
}

export function emptyRepairSummary(): PoleRepairSummary {
  return { total: 0, todo: 0, inProgress: 0, awaiting: 0, closed: 0, emergency: 0, categories: [] };
}

export function addToRepairSummary(
  summary: PoleRepairSummary,
  defect: {
    lifecycleStatus: DefectLifecycleStatus | null;
    status: DefectStatus;
    isEmergency: boolean;
    maintenanceCategory: MaintenanceCategory | null;
  },
): void {
  const stage = repairStage(defect);
  summary.total += 1;
  summary[stage] += 1;
  if (defect.isEmergency && (stage === 'todo' || stage === 'inProgress')) {
    summary.emergency += 1;
  }
  const category = defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN;
  if (!summary.categories.includes(category)) {
    summary.categories.push(category);
  }
}

/** Valid maintenance categories from a CSV-split query value. */
export function parseCategories(values: string[]): MaintenanceCategory[] {
  return values.filter((value): value is MaintenanceCategory =>
    (Object.values(MaintenanceCategory) as string[]).includes(value),
  );
}

/** A category match that, like the map, buckets an untagged defect as SELENGGARAAN. */
export function categoryDefectWhere(
  categories: MaintenanceCategory[],
): Prisma.DefectWhereInput {
  const match: Prisma.DefectWhereInput[] = [{ maintenanceCategory: { in: categories } }];
  if (categories.includes(MaintenanceCategory.SELENGGARAAN)) {
    match.push({ maintenanceCategory: null });
  }
  return { OR: match };
}

/**
 * The caller's routed, released Kejanggalan (optionally one or more work types).
 * Released = not the dormant pre-report DETECTED state and not thrown out.
 */
export function repairDefectWhere(
  orgIds: string[],
  categories: MaintenanceCategory[] = [],
): Prisma.DefectWhereInput {
  const and: Prisma.DefectWhereInput[] = [
    { maintenanceOrganizationId: { in: orgIds } },
    { inspectionItemResult: { isDefect: true } },
    {
      OR: [
        { lifecycleStatus: null },
        {
          lifecycleStatus: {
            notIn: [DefectLifecycleStatus.DETECTED, DefectLifecycleStatus.REJECTED],
          },
        },
      ],
    },
  ];
  if (categories.length > 0) {
    and.push(categoryDefectWhere(categories));
  }
  return { AND: and };
}
