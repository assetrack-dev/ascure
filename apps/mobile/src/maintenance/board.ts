/**
 * The maintenance board (GET /maintenance-packages/board) as the manager's
 * progress screen sees it — docs/PLAN-maintenance-flow.md §18. Same payload and
 * scope rules as the web's Maintenance Packages page: a subcontractor sees its
 * own company's work, a Main Contractor its own + its subcontractors'.
 */
import type { MaintenanceCategory } from './types';

export type BoardActorKind = 'ADMIN' | 'TNB' | 'MAIN_CONTRACTOR' | 'COMPANY';

export type BoardRef = { id: string; name: string };

export type BoardCompany = {
  id: string;
  name: string;
  code?: string | null;
  type: string;
  parentOrganizationId?: string | null;
};

export type BoardTeam = { id: string; name: string; code?: string | null; organizationId: string };

/** todo = not started; awaiting = repaired, waiting for TNB / the main contractor. */
export type BoardProgress = { todo: number; inProgress: number; awaiting: number; closed: number };

export type BoardLane = {
  category: MaintenanceCategory;
  total: number;
  open: number;
  finished: number;
  noTeam?: number;
  unrouted?: number;
  poles?: number;
  progress?: BoardProgress;
  organization: BoardRef | null;
  team: BoardRef | null;
  canAssign: boolean;
};

export type BoardPackage = {
  id: string;
  category: MaintenanceCategory | null;
  organization: BoardRef;
  team: BoardRef | null;
  dueDate: string | null;
  notes: string | null;
};

export type BoardPoleSplit = {
  category: MaintenanceCategory | null;
  organization: BoardRef;
  team: BoardRef | null;
  poles: number;
};

export type BoardPencawang = {
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  latitude: number | null;
  longitude: number | null;
  canAssign: boolean;
  mainhead: BoardRef | null;
  poleCount: number;
  totals: { total: number; open: number; finished: number; unrouted: number; noTeam?: number };
  progress?: BoardProgress;
  lanes: BoardLane[];
  poleSplits: BoardPoleSplit[];
  packages: BoardPackage[];
};

export type MaintenanceBoard = {
  actorKind: BoardActorKind;
  canAssign: boolean;
  companies: BoardCompany[];
  teams: BoardTeam[];
  pencawangs: BoardPencawang[];
};

export const WORK_TYPES: MaintenanceCategory[] = ['RENTIS', 'CAT_TIANG', 'SELENGGARAAN'];

const EMPTY: BoardProgress = { todo: 0, inProgress: 0, awaiting: 0, closed: 0 };

/** Progress of a PE / lane; older APIs only had open / finished. */
export function progressOf(item: {
  progress?: BoardProgress;
  totals?: { open: number; finished: number };
  open?: number;
  finished?: number;
}): BoardProgress {
  if (item.progress) return item.progress;
  const open = item.totals?.open ?? item.open ?? 0;
  const finished = item.totals?.finished ?? item.finished ?? 0;
  return { todo: open, inProgress: 0, awaiting: 0, closed: finished };
}

export function addProgress(left: BoardProgress, right: BoardProgress): BoardProgress {
  return {
    todo: left.todo + right.todo,
    inProgress: left.inProgress + right.inProgress,
    awaiting: left.awaiting + right.awaiting,
    closed: left.closed + right.closed,
  };
}

export function progressTotal(progress: BoardProgress) {
  return progress.todo + progress.inProgress + progress.awaiting + progress.closed;
}

/** Status word of a PE (or one work type of it). */
export type PeStatus = 'NO_COMPANY' | 'NOT_STARTED' | 'IN_PROGRESS' | 'WAITING' | 'DONE';

export const STATUS_LABEL: Record<PeStatus, string> = {
  NO_COMPANY: 'Not given out',
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  WAITING: 'Waiting TNB',
  DONE: 'All closed',
};

/** Same colours as the web map (fixed hex: they also paint on the satellite map). */
export const STATUS_COLOR: Record<PeStatus, string> = {
  NO_COMPANY: '#64748b',
  NOT_STARTED: '#dc2626',
  IN_PROGRESS: '#f59e0b',
  WAITING: '#2563eb',
  DONE: '#16a34a',
};

export function statusOf(progress: BoardProgress, unrouted = 0): PeStatus {
  if (unrouted > 0) return 'NO_COMPANY';
  if (progress.todo + progress.inProgress + progress.awaiting === 0) return 'DONE';
  if (progress.todo + progress.inProgress === 0) return 'WAITING';
  if (progress.inProgress + progress.awaiting + progress.closed === 0) return 'NOT_STARTED';
  return 'IN_PROGRESS';
}

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

function isOverdue(dueDate: string | null, open: number) {
  return dueDate !== null && open > 0 && new Date(dueDate).getTime() < startOfToday();
}

/** The package that sets this work type's target date: its own, else the whole-PE one. */
export function lanePackage(row: BoardPencawang, category: MaintenanceCategory | null) {
  return (
    (category ? row.packages.find((pkg) => pkg.category === category) : undefined) ??
    row.packages.find((pkg) => pkg.category === null) ??
    null
  );
}

export type LaneInfo = {
  category: MaintenanceCategory;
  /** "Team A" (SUB) / "SubCo · Team A" (MC) / "No team" / "Not given out". */
  owner: string;
  ownerTone: 'team' | 'noTeam' | 'noCompany';
  progress: BoardProgress;
  total: number;
  open: number;
  noTeam: number;
  status: PeStatus;
  dueDate: string | null;
  overdue: boolean;
  /** Poles of this work type handed to other crews (web: split by poles). */
  splits: string[];
  canAssign: boolean;
};

/** One work type of a PE, or null when it has none. */
export function laneInfo(
  row: BoardPencawang,
  category: MaintenanceCategory,
  board: MaintenanceBoard,
): LaneInfo | null {
  const lane = row.lanes.find((candidate) => candidate.category === category);
  if (!lane || lane.total === 0) return null;
  const isCompany = board.actorKind === 'COMPANY';
  const own = new Set(board.companies.map((company) => company.id));
  const progress = progressOf(lane);
  const pkg = lanePackage(row, category);
  const dueDate = pkg?.dueDate ?? null;

  let owner: string;
  let ownerTone: LaneInfo['ownerTone'];
  if (!lane.organization) {
    owner = 'Not given out';
    ownerTone = 'noCompany';
  } else if (lane.team) {
    owner = isCompany ? lane.team.name : `${lane.organization.name} · ${lane.team.name}`;
    ownerTone = 'team';
  } else {
    owner = isCompany ? 'No team' : `${lane.organization.name} · no team`;
    ownerTone = 'noTeam';
  }

  return {
    category,
    owner,
    ownerTone,
    progress,
    total: lane.total,
    open: lane.open,
    noTeam: lane.noTeam ?? 0,
    status: statusOf(progress, lane.unrouted ?? 0),
    dueDate,
    overdue: isOverdue(dueDate, lane.open),
    splits: row.poleSplits
      .filter((split) => split.category === category || split.category === null)
      .filter((split) => !isCompany || own.has(split.organization.id))
      .map((split) => {
        const who = split.team
          ? isCompany
            ? split.team.name
            : `${split.organization.name} · ${split.team.name}`
          : isCompany
            ? 'No team'
            : split.organization.name;
        return `${who} ${split.poles} pole${split.poles === 1 ? '' : 's'}`;
      }),
    canAssign: board.canAssign && lane.canAssign,
  };
}

export type PeSummary = {
  row: BoardPencawang;
  lanes: LaneInfo[];
  progress: BoardProgress;
  total: number;
  open: number;
  noTeam: number;
  status: PeStatus;
  /** Earliest target date of the shown work types. */
  dueDate: string | null;
  overdue: boolean;
};

/** The PE narrowed to the shown work types (all, or the one picked). */
export function summarize(
  row: BoardPencawang,
  board: MaintenanceBoard,
  workTypes: MaintenanceCategory[],
): PeSummary | null {
  const lanes = workTypes
    .map((category) => laneInfo(row, category, board))
    .filter((lane): lane is LaneInfo => lane !== null);
  if (lanes.length === 0) return null;
  const progress = lanes.map((lane) => lane.progress).reduce(addProgress, EMPTY);
  const dueDate =
    lanes
      .map((lane) => lane.dueDate)
      .filter((date): date is string => Boolean(date))
      .sort()[0] ?? null;
  const unrouted = lanes.some((lane) => lane.ownerTone === 'noCompany') ? 1 : 0;
  return {
    row,
    lanes,
    progress,
    total: lanes.reduce((sum, lane) => sum + lane.total, 0),
    open: lanes.reduce((sum, lane) => sum + lane.open, 0),
    noTeam: lanes.reduce((sum, lane) => sum + lane.noTeam, 0),
    status: statusOf(progress, unrouted),
    dueDate,
    overdue: lanes.some((lane) => lane.overdue),
  };
}

/** Does the team (or, for a Main Contractor, the company) hold any shown work of the PE? */
export function holdsWork(summary: PeSummary, filter: { teamId?: string; companyId?: string }) {
  const { row } = summary;
  const shown = new Set(summary.lanes.map((lane) => lane.category));
  const inScope = (category: MaintenanceCategory | null) => category === null || shown.has(category);
  if (filter.teamId) {
    return (
      row.lanes.some((lane) => shown.has(lane.category) && lane.team?.id === filter.teamId) ||
      row.poleSplits.some((split) => inScope(split.category) && split.team?.id === filter.teamId)
    );
  }
  if (filter.companyId) {
    return (
      row.lanes.some((lane) => shown.has(lane.category) && lane.organization?.id === filter.companyId) ||
      row.poleSplits.some((split) => inScope(split.category) && split.organization.id === filter.companyId)
    );
  }
  return true;
}

export function pencawangLabel(row: Pick<BoardPencawang, 'pencawangName' | 'pencawangCode'>) {
  return row.pencawangName || row.pencawangCode || 'Unnamed Pencawang';
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const BOARD_CACHE_NAMESPACE = 'maintenance-board';

// ── Assign (plan §18, M45) ──────────────────────────────────────────────────

export type AssignPackageBody = {
  siteVisitId: string;
  /** null = the whole Pencawang. */
  category: MaintenanceCategory | null;
  maintenanceOrganizationId: string;
  assignedTeamId: string | null;
  dueDate: string | null;
  notes: string | null;
};

export type AssignRouting = {
  routed: number;
  moved: number;
  kept: number;
  teamAssigned: number;
  teamCleared?: number;
};

/** "Saved — 3 handed to the team." (same wording as the web). */
export function routingMessage(result: AssignRouting) {
  const parts: string[] = [];
  if (result.routed) parts.push(`${result.routed} routed`);
  if (result.moved) parts.push(`${result.moved} moved`);
  if (result.teamAssigned) parts.push(`${result.teamAssigned} handed to the team`);
  if (result.teamCleared) parts.push(`${result.teamCleared} taken off the team`);
  if (result.kept) parts.push(`${result.kept} kept with the previous crew (work already started)`);
  return parts.length > 0 ? `Saved — ${parts.join(', ')}.` : 'Saved — no Kejanggalan changed hands.';
}

/**
 * The target date + notes to send back unchanged: the work type's own package,
 * else the whole-PE one; for the whole PE, its package or the earliest lane date.
 */
export function keptPackageFields(row: BoardPencawang, category: MaintenanceCategory | null) {
  if (category) {
    const pkg = lanePackage(row, category);
    return { dueDate: pkg?.dueDate ?? null, notes: pkg?.notes ?? null };
  }
  const whole = row.packages.find((pkg) => pkg.category === null);
  if (whole) return { dueDate: whole.dueDate, notes: whole.notes };
  const earliest =
    row.packages
      .map((pkg) => pkg.dueDate)
      .filter((date): date is string => Boolean(date))
      .sort()[0] ?? null;
  return { dueDate: earliest, notes: null };
}
