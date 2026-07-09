"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  Info,
  Layers,
  MapPin,
  Plus,
  RefreshCw,
  UserPlus,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { Card, Chip, KpiCard, PageHeader, Tbtn, type Tone } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  assignMaintenanceLane,
  fetchMaintenanceWorkspace,
} from "@/lib/maintenance-workspace";
import type { AuthSession } from "@/types/auth";
import type {
  AssignMaintenanceLanePayload,
  MaintenanceCategory,
  MaintenanceWorkspace,
  WorkspaceAssignableTeam,
  WorkspaceEmergency,
  WorkspaceLane,
  WorkspacePackage,
} from "@/types/maintenance-workspace";
import { DISPLAY_STATUS_LABELS, type DisplayStatus } from "@/types/site-visits";

type AssignHandler = (payload: AssignMaintenanceLanePayload) => void;
type OpenMapHandler = (substationId: string) => void;

/** Sentinel group for Pencawang that have never been surveyed. */
const NO_SURVEY_GROUP = "NO_SURVEY";

/**
 * Packages are grouped by the Pencawang's survey status. Completed leads because
 * it is the only group whose defects can be assigned out to a maintenance team.
 */
const STATUS_GROUP_ORDER: DisplayStatus[] = [
  "COMPLETED",
  "IN_REVIEW",
  "NEEDS_AMENDMENT",
  "IN_PROGRESS",
  "NOT_STARTED",
  "ARCHIVED",
  "CANCELLED",
];

/**
 * Lane dots. `--amber` / `--slate` exist because Tailwind's `amber-500` and
 * `slate-400` are remapped to `--medium` / `--muted-2` by the `@theme inline`
 * block in globals.css — neither is the hue this legend needs.
 */
const CATEGORY_META: Record<MaintenanceCategory, { label: string; dot: string }> = {
  RENTIS: { label: "Rentis", dot: "bg-[var(--success)]" },
  CAT_TIANG: { label: "Cat tiang", dot: "bg-[var(--amber)]" },
  SELENGGARAAN: { label: "Selenggaraan", dot: "bg-[var(--slate)]" },
};

const CATEGORY_ORDER: MaintenanceCategory[] = ["RENTIS", "CAT_TIANG", "SELENGGARAAN"];

function severityTone(severity: string): Tone {
  const normalized = severity.toUpperCase();
  if (normalized === "CRITICAL") return "critical";
  if (normalized === "HIGH") return "high";
  if (normalized === "MEDIUM") return "warning";
  return "neutral";
}

function surveyStatusTone(key: string): Tone {
  if (key === "COMPLETED") return "success";
  if (key === "IN_REVIEW") return "brand";
  if (key === "NEEDS_AMENDMENT") return "high";
  if (key === "IN_PROGRESS") return "info";
  if (key === "CANCELLED") return "critical";
  return "neutral";
}

function statusGroupLabel(key: string) {
  return key === NO_SURVEY_GROUP ? "No survey yet" : DISPLAY_STATUS_LABELS[key as DisplayStatus];
}

function formatDate(date: string | null | undefined) {
  if (!date) {
    return "No date";
  }

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

/**
 * The lane's assignment state, as one sentence. `assigned` drives the control's
 * two looks: a dashed "add" affordance vs. a filled brand pill.
 */
function laneStatus(lane: WorkspaceLane): { text: string; tone: Tone; assigned: boolean } {
  if (lane.unassignedCount === lane.count) {
    return { text: "Unassigned", tone: "warning", assigned: false };
  }

  if (lane.unassignedCount === 0) {
    if (lane.teams.length === 1) {
      return { text: lane.teams[0].name, tone: "brand", assigned: true };
    }

    if (lane.teams.length > 1) {
      return { text: `${lane.teams.length} teams`, tone: "brand", assigned: true };
    }
  }

  const assignedCount = lane.count - lane.unassignedCount;

  return {
    text: `${assignedCount}/${lane.count} assigned`,
    tone: assignedCount > 0 ? "brand" : "warning",
    assigned: assignedCount > 0,
  };
}

function oldestEmergency(emergencies: WorkspaceEmergency[]): WorkspaceEmergency | null {
  if (emergencies.length === 0) {
    return null;
  }

  return emergencies.reduce((oldest, emergency) => {
    const left = new Date(emergency.createdAt).getTime();
    const right = new Date(oldest.createdAt).getTime();
    return Number.isFinite(left) && left < right ? emergency : oldest;
  }, emergencies[0]);
}

function EmergencyLane({ workspace }: { workspace: MaintenanceWorkspace }) {
  // Rows are open by default: the previous page always showed them, and an
  // emergency is not something to hide behind a disclosure.
  const [isOpen, setIsOpen] = useState(true);

  if (workspace.emergencyCount === 0 || workspace.emergencies.length === 0) {
    return null;
  }

  const oldest = oldestEmergency(workspace.emergencies);

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-gradient-to-r from-[var(--danger-tint)] to-[var(--panel)] shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-4 p-[18px]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--critical-border)] bg-[var(--panel)] text-[var(--critical)] shadow-[var(--shadow-soft)]">
          <AlertTriangle size={18} />
        </span>

        <div className="min-w-0 flex-1">
          <h2
            className="text-[14.5px] font-semibold leading-tight text-[var(--critical-text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {workspace.emergencyCount} emergenc{workspace.emergencyCount === 1 ? "y" : "ies"} —
            respond now
          </h2>
          <p className="mt-1 truncate text-[12px] text-[var(--muted)]">
            {oldest ? (
              <>
                Oldest: <span className="font-mono">{oldest.assetCode}</span> ·{" "}
                {oldest.substationName} · {formatDate(oldest.createdAt)}
              </>
            ) : (
              "Across all Pencawang"
            )}
          </p>
        </div>

        <Tbtn
          variant="danger"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <ChevronDown size={15} className={isOpen ? "rotate-180 transition-transform" : "transition-transform"} />
          {isOpen ? "Hide details" : `Review ${workspace.emergencyCount}`}
        </Tbtn>
      </div>

      {isOpen ? (
        <div className="border-t border-[var(--critical-border)] bg-[var(--panel)]">
          {workspace.emergencies.map((emergency) => (
            <div
              key={emergency.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line2)] px-[18px] py-2.5 last:border-b-0"
            >
              <div className="min-w-0 text-[13px]">
                <span className="font-mono font-semibold text-[var(--foreground)]">
                  {emergency.assetCode}
                </span>
                <span className="text-[var(--foreground-soft)]"> · {emergency.label}</span>
                <span className="text-[var(--muted)]"> · {emergency.substationName}</span>
              </div>
              <Chip tone={severityTone(emergency.severity)}>{emergency.severity}</Chip>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A native `<select>` under a pill. The select keeps every behaviour it had —
 * value reset, disabled state, the `__none__` unassign option — while the pill
 * carries the two looks the design asks for. `peer-focus-visible` restores the
 * focus ring the transparent select can no longer draw.
 */
function AssignSelect({
  teams,
  busy,
  label,
  assignedName,
  onPick,
}: {
  teams: WorkspaceAssignableTeam[];
  busy: boolean;
  label: string;
  assignedName?: string | null;
  onPick: (teamId: string | null) => void;
}) {
  const isDisabled = busy || teams.length === 0;
  const isAssigned = Boolean(assignedName);

  return (
    <div className={`relative inline-flex shrink-0 ${isDisabled ? "opacity-50" : ""}`}>
      <select
        disabled={isDisabled}
        value=""
        onChange={(event) => {
          const value = event.target.value;
          event.currentTarget.value = "";
          if (!value) return;
          onPick(value === "__none__" ? null : value);
        }}
        aria-label={label}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      >
        <option value="">{label}</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
        <option value="__none__">Unassign</option>
      </select>

      <span
        className={`pointer-events-none inline-flex h-8 max-w-[180px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition peer-focus-visible:ring-[3px] peer-focus-visible:ring-[var(--focus-ring)] ${
          isAssigned
            ? "border-[var(--brand-soft)] bg-[var(--brand-tint)] text-[var(--brand-strong)]"
            : "border-dashed border-[var(--line-strong)] bg-[var(--panel)] text-[var(--muted)] peer-hover:border-[var(--brand)] peer-hover:text-[var(--brand)]"
        }`}
      >
        {isAssigned ? <Check size={13} className="shrink-0" /> : <Plus size={13} className="shrink-0" />}
        <span className="truncate">{isAssigned ? assignedName : label}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </span>
    </div>
  );
}

function PackageCard({
  pkg,
  canAssign,
  teams,
  busy,
  onAssign,
  onOpenMap,
}: {
  pkg: WorkspacePackage;
  canAssign: boolean;
  teams: WorkspaceAssignableTeam[];
  busy: boolean;
  onAssign: AssignHandler;
  onOpenMap: OpenMapHandler;
}) {
  const laneByCategory = new Map(pkg.lanes.map((lane) => [lane.category, lane]));
  // Role permits assigning AND the survey is Completed (report generated). The
  // server enforces the second half independently — this only hides the picker.
  const canAssignHere = canAssign && pkg.assignable;
  const isAwaitingReview = pkg.displayStatus === "IN_REVIEW";
  const statusKey = pkg.displayStatus ?? NO_SURVEY_GROUP;

  return (
    <Card className={isAwaitingReview ? "opacity-60 transition-opacity hover:opacity-100" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Chip tone={surveyStatusTone(statusKey)} dot>
              {pkg.displayStatusLabel ?? statusGroupLabel(statusKey)}
            </Chip>
            <button
              type="button"
              onClick={() => onOpenMap(pkg.substation.id)}
              title="Open the defect map for this Pencawang"
              className="group flex min-w-0 items-center gap-1.5 text-left"
            >
              <h3
                className="truncate text-[14.5px] font-semibold leading-tight text-[var(--foreground)] group-hover:text-[var(--brand)] group-hover:underline"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {pkg.substation.name}
              </h3>
              <MapPin
                size={14}
                className="shrink-0 text-[var(--muted-2)] group-hover:text-[var(--brand)]"
              />
            </button>
          </div>
          <p className="mt-1.5 text-[12px] text-[var(--muted)]">
            <span className="font-mono">{pkg.substation.code}</span>
            {pkg.mainhead ? ` · ${pkg.mainhead.name}` : ""} · {pkg.totalCount} defects
          </p>
        </div>

        {canAssignHere && pkg.totalCount > 0 ? (
          <AssignSelect
            teams={teams}
            busy={busy}
            label="Assign all…"
            onPick={(teamId) =>
              onAssign({ substationId: pkg.substation.id, assignedToTeamId: teamId })
            }
          />
        ) : canAssign && !pkg.assignable ? (
          <Chip tone="warning" title="Defects release to maintenance once the survey report is generated">
            <Info size={12} className="shrink-0" />
              Assign after report
          </Chip>
        ) : (
          <Chip tone="neutral">
            <Building2 size={12} className="shrink-0" />
              Pencawang
          </Chip>
        )}
      </div>

      {isAwaitingReview ? (
        <p className="mt-3 text-[12px] font-medium text-[var(--muted)]">
          Awaiting review — assignment unlocks once the survey completes.
        </p>
      ) : null}

      {pkg.emergencyCount > 0 ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--critical)]">
          <AlertTriangle size={13} className="shrink-0" />
          {pkg.emergencyCount} emergency{pkg.emergencyCount > 1 ? " items" : ""} — handled in priority
          lane
        </p>
      ) : null}

      <div className="mt-3 divide-y divide-[var(--line2)]">
        {CATEGORY_ORDER.map((category) => {
          const lane = laneByCategory.get(category) ?? {
            category,
            count: 0,
            unassignedCount: 0,
            inProgressCount: 0,
            teams: [],
          };
          const status = laneStatus(lane);
          const meta = CATEGORY_META[category];

          return (
            <div
              key={category}
              className="grid grid-cols-[150px_1fr_auto] items-center gap-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                <span className="truncate text-[13px] font-medium text-[var(--foreground-soft)]">
                  {meta.label}
                </span>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                  {lane.count}
                </span>
                {lane.inProgressCount > 0 ? (
                  <Chip tone="info">{lane.inProgressCount} in progress</Chip>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center justify-end">
                {lane.count === 0 ? (
                  <span className="text-[12px] text-[var(--muted-2)]">—</span>
                ) : canAssignHere ? (
                  <AssignSelect
                    teams={teams}
                    busy={busy}
                    label="Assign team"
                    assignedName={status.assigned ? status.text : null}
                    onPick={(teamId) =>
                      onAssign({
                        substationId: pkg.substation.id,
                        category,
                        assignedToTeamId: teamId,
                      })
                    }
                  />
                ) : (
                  <Chip tone={status.tone}>{status.text}</Chip>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WorkspaceLoading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-[112px] animate-pulse rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel-muted)]"
          />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-44 animate-pulse rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel-muted)]"
          />
        ))}
      </div>
    </div>
  );
}

function MaintenanceWorkspaceContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [workspace, setWorkspace] = useState<MaintenanceWorkspace | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadWorkspace = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const next = await fetchMaintenanceWorkspace(token);
        setWorkspace(next);
      } catch (workspaceError) {
        if (workspaceError instanceof ApiError && workspaceError.status === 401) {
          handleLogout();
          return;
        }
        setError(
          workspaceError instanceof Error
            ? workspaceError.message
            : "Unable to load the maintenance workspace.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  /**
   * Drill through to the map, scoped to this Pencawang and showing only poles that
   * carry open defects. `from` drives the map's Back button (same convention as
   * the asset-detail page).
   */
  const handleOpenMap = useCallback<OpenMapHandler>(
    (substationId) => {
      const params = new URLSearchParams({
        substationId,
        defectsOnly: "1",
        from: "/maintenance-workspace",
      });
      router.push(`/map?${params.toString()}`);
    },
    [router],
  );

  /** Packages bucketed by the Pencawang's survey status, Completed first. */
  const groupedPackages = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const byStatus = new Map<string, WorkspacePackage[]>();

    for (const pkg of workspace.packages) {
      const key = pkg.displayStatus ?? NO_SURVEY_GROUP;
      const bucket = byStatus.get(key);

      if (bucket) {
        bucket.push(pkg);
      } else {
        byStatus.set(key, [pkg]);
      }
    }

    return [...STATUS_GROUP_ORDER, NO_SURVEY_GROUP]
      .filter((key) => byStatus.has(key))
      .map((key) => {
        const packages = byStatus.get(key) ?? [];

        return {
          key,
          label: statusGroupLabel(key),
          packages,
          defectCount: packages.reduce((total, pkg) => total + pkg.totalCount, 0),
        };
      });
  }, [workspace]);

  /** Rolled up from the lanes already on the page — no extra request. */
  const laneTotals = useMemo(() => {
    if (!workspace) {
      return { unassigned: 0, inProgress: 0 };
    }

    let unassigned = 0;
    let inProgress = 0;

    for (const pkg of workspace.packages) {
      for (const lane of pkg.lanes) {
        unassigned += lane.unassignedCount;
        inProgress += lane.inProgressCount;
      }
    }

    return { unassigned, inProgress };
  }, [workspace]);

  const handleAssign = useCallback<AssignHandler>(
    (payload) => {
      const token = session?.token;
      if (!token) {
        return;
      }

      setIsAssigning(true);
      setError("");

      void (async () => {
        try {
          await assignMaintenanceLane(token, payload);
          await loadWorkspace(token);
        } catch (assignError) {
          if (assignError instanceof ApiError && assignError.status === 401) {
            handleLogout();
            return;
          }
          setError(
            assignError instanceof Error
              ? assignError.message
              : "Unable to update the assignment.",
          );
        } finally {
          setIsAssigning(false);
        }
      })();
    },
    [handleLogout, loadWorkspace, session?.token],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadWorkspace(storedSession.token);
    }
  }, [loadWorkspace]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Maintenance Workspace"
            title="Assign & dispatch"
            subtitle="Open defects packaged by Pencawang, split into Rentis / Cat tiang / Selenggaraan lanes. Emergencies stay in the priority lane above."
            chips={
              workspace ? (
                <>
                  <Chip tone="neutral">
                    <Wrench size={12} className="shrink-0" />
                      {workspace.totalRouted.toLocaleString()} routed
                  </Chip>
                  {workspace.emergencyCount > 0 ? (
                    <Chip tone="critical">
                      <AlertTriangle size={12} className="shrink-0" />
                        {workspace.emergencyCount} emergenc
                        {workspace.emergencyCount === 1 ? "y" : "ies"}
                    </Chip>
                  ) : null}
                </>
              ) : null
            }
            actions={
              <Tbtn
                onClick={() => (session?.token ? loadWorkspace(session.token) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6 space-y-6">
            {isLoading && !workspace ? (
              <WorkspaceLoading />
            ) : error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : workspace ? (
              <>
                <EmergencyLane workspace={workspace} />

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard
                    label="Packages"
                    value={workspace.packages.length.toLocaleString()}
                    icon={Layers}
                    context="Pencawang with open defects"
                  />
                  <KpiCard
                    label="Unassigned defects"
                    value={laneTotals.unassigned.toLocaleString()}
                    icon={UserPlus}
                    tone="high"
                    context="Waiting on a maintenance team"
                  />
                  <KpiCard
                    label="In progress"
                    value={laneTotals.inProgress.toLocaleString()}
                    icon={Activity}
                    tone="info"
                    context="Work started in the field"
                  />
                  <KpiCard
                    label="Routed defects"
                    value={workspace.totalRouted.toLocaleString()}
                    icon={Wrench}
                    context="Total in the maintenance pool"
                  />
                </div>

                {workspace.governanceMode === "INSPECTOR_OWNS" ? (
                  <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-[12.5px] text-[var(--muted)]">
                    <Info size={15} className="mt-0.5 shrink-0 text-[var(--muted-2)]" />
                    <span>
                      Inspector-owns mode: these are your team&apos;s open defects. Cross-company
                      routing to a maintenance company activates when{" "}
                      <code className="rounded bg-[var(--surface-pressed)] px-1 py-0.5 font-mono text-[11px] text-[var(--foreground-soft)]">
                        RELEASE_ON_REPORT
                      </code>{" "}
                      is enabled.
                    </span>
                  </div>
                ) : null}

                {workspace.packages.length > 0 ? (
                  <div className="space-y-8">
                    {groupedPackages.map((group) => (
                      <section key={group.key}>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2">
                          <div className="flex items-center gap-2">
                            <Chip tone={surveyStatusTone(group.key)} dot>
                              {group.label}
                            </Chip>
                          </div>
                          <span className="text-[12px] font-medium text-[var(--muted)]">
                            {group.packages.length} Pencawang
                            {group.packages.length === 1 ? "" : "s"} · {group.defectCount}{" "}
                            defect{group.defectCount === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="grid gap-5 lg:grid-cols-2">
                          {group.packages.map((pkg) => (
                            <PackageCard
                              key={pkg.substation.id}
                              pkg={pkg}
                              canAssign={workspace.canAssign}
                              teams={workspace.assignableTeams}
                              busy={isAssigning}
                              onAssign={handleAssign}
                              onOpenMap={handleOpenMap}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <Card className="px-5 py-12 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]">
                      <Wrench size={20} />
                    </div>
                    <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">
                      No routed defects
                    </p>
                    <p className="mt-1 text-[12.5px] text-[var(--muted)]">
                      Packages appear here as open defects are routed to the maintenance pool.
                    </p>
                  </Card>
                )}
              </>
            ) : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function MaintenanceWorkspaceClient() {
  return (
    <AuthGuard>
      <MaintenanceWorkspaceContent />
    </AuthGuard>
  );
}
