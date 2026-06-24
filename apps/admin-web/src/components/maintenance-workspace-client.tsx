"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, Info, RefreshCw, Wrench } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
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
  WorkspaceLane,
  WorkspacePackage,
} from "@/types/maintenance-workspace";

type AssignHandler = (payload: AssignMaintenanceLanePayload) => void;

const CATEGORY_META: Record<MaintenanceCategory, { label: string; dot: string }> = {
  RENTIS: { label: "Rentis", dot: "bg-green-500" },
  CAT_TIANG: { label: "Cat tiang", dot: "bg-amber-500" },
  SELENGGARAAN: { label: "Selenggaraan", dot: "bg-slate-400" },
};

function severityClassName(severity: string) {
  const normalized = severity.toUpperCase();
  if (normalized === "CRITICAL") return "border-red-200 bg-red-50 text-red-700";
  if (normalized === "HIGH") return "border-orange-200 bg-orange-50 text-orange-700";
  if (normalized === "MEDIUM") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function laneStatus(lane: WorkspaceLane): { text: string; className: string } {
  if (lane.count === 0) {
    return { text: "—", className: "border-transparent text-slate-300" };
  }
  if (lane.unassignedCount === lane.count) {
    return { text: "Unassigned", className: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  if (lane.inProgressCount > 0) {
    return { text: "In progress", className: "border-blue-200 bg-blue-50 text-blue-700" };
  }
  if (lane.teams.length === 1 && lane.unassignedCount === 0) {
    return { text: lane.teams[0].name, className: "border-blue-200 bg-blue-50 text-blue-700" };
  }
  const assigned = lane.count - lane.unassignedCount;
  return {
    text: `${assigned}/${lane.count} assigned`,
    className: "border-slate-200 bg-slate-50 text-slate-600",
  };
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 shadow-[var(--shadow-soft)]">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold ${tone === "danger" && value > 0 ? "text-red-600" : "text-[var(--foreground)]"}`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function EmergencyLane({ workspace }: { workspace: MaintenanceWorkspace }) {
  if (workspace.emergencies.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-red-200 bg-red-50/60 p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-4">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-red-900">
          <AlertTriangle size={17} />
          Emergencies — respond now
        </h2>
        <span className="text-sm font-semibold text-red-700">
          {workspace.emergencyCount} active · all Pencawang
        </span>
      </div>
      <div className="mt-4 divide-y divide-red-100">
        {workspace.emergencies.map((emergency) => (
          <div
            key={emergency.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <span className="font-semibold text-red-950">{emergency.assetCode}</span>
              <span className="text-sm text-red-800"> · {emergency.label}</span>
              <span className="text-sm text-red-700/80"> · {emergency.substationName}</span>
            </div>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${severityClassName(emergency.severity)}`}
            >
              {emergency.severity}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssignSelect({
  teams,
  busy,
  label,
  onPick,
}: {
  teams: WorkspaceAssignableTeam[];
  busy: boolean;
  label: string;
  onPick: (teamId: string | null) => void;
}) {
  return (
    <select
      disabled={busy || teams.length === 0}
      value=""
      onChange={(event) => {
        const value = event.target.value;
        event.currentTarget.value = "";
        if (!value) return;
        onPick(value === "__none__" ? null : value);
      }}
      aria-label={label}
      className="h-8 max-w-40 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)] outline-none transition hover:border-[var(--brand)] focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
    >
      <option value="">{label}</option>
      {teams.map((team) => (
        <option key={team.id} value={team.id}>
          {team.name}
        </option>
      ))}
      <option value="__none__">Unassign</option>
    </select>
  );
}

function PackageCard({
  pkg,
  canAssign,
  teams,
  busy,
  onAssign,
}: {
  pkg: WorkspacePackage;
  canAssign: boolean;
  teams: WorkspaceAssignableTeam[];
  busy: boolean;
  onAssign: AssignHandler;
}) {
  const categories: MaintenanceCategory[] = ["RENTIS", "CAT_TIANG", "SELENGGARAAN"];
  const laneByCategory = new Map(pkg.lanes.map((lane) => [lane.category, lane]));

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            {pkg.substation.name}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {pkg.substation.code}
            {pkg.mainhead ? ` · ${pkg.mainhead.name}` : ""} · {pkg.totalCount} defects
          </p>
        </div>
        {canAssign && pkg.totalCount > 0 ? (
          <AssignSelect
            teams={teams}
            busy={busy}
            label="Assign all…"
            onPick={(teamId) =>
              onAssign({ substationId: pkg.substation.id, assignedToTeamId: teamId })
            }
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-[var(--shadow-soft)]">
            <Building2 size={13} />
            Pencawang
          </span>
        )}
      </div>

      {pkg.emergencyCount > 0 ? (
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
          <AlertTriangle size={13} />
          {pkg.emergencyCount} emergency{pkg.emergencyCount > 1 ? " items" : ""} — handled in priority lane
        </div>
      ) : null}

      <div className="mt-3 divide-y divide-slate-100">
        {categories.map((category) => {
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
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                <span className="font-medium text-slate-800">{meta.label}</span>
                <span className="text-sm text-[var(--muted)]">{lane.count}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}
                >
                  {status.text}
                </span>
                {canAssign && lane.count > 0 ? (
                  <AssignSelect
                    teams={teams}
                    busy={busy}
                    label="Assign"
                    onPick={(teamId) =>
                      onAssign({
                        substationId: pkg.substation.id,
                        category,
                        assignedToTeamId: teamId,
                      })
                    }
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase text-[var(--brand)]">
                <Wrench size={15} />
                Maintenance
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Maintenance Workspace
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Open defects packaged by Pencawang, split into Rentis / Cat tiang / Selenggaraan
                lanes. Emergencies stay in the priority lane above.
              </p>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadWorkspace(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6 space-y-6">
            {isLoading && !workspace ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-44 animate-pulse rounded-xl border border-[var(--line)] bg-white shadow-[var(--shadow-soft)]"
                  />
                ))}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : workspace ? (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <SummaryChip label="Routed defects" value={workspace.totalRouted} />
                  <SummaryChip label="Pencawang packages" value={workspace.packages.length} />
                  <SummaryChip label="Emergencies" value={workspace.emergencyCount} tone="danger" />
                </div>

                {workspace.governanceMode === "INSPECTOR_OWNS" ? (
                  <div className="inline-flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <Info size={16} className="mt-0.5 shrink-0 text-slate-400" />
                    <span>
                      Inspector-owns mode: these are your team&apos;s open defects. Cross-company
                      routing to a maintenance company activates when{" "}
                      <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">RELEASE_ON_REPORT</code>{" "}
                      is enabled.
                    </span>
                  </div>
                ) : null}

                <EmergencyLane workspace={workspace} />

                {workspace.packages.length > 0 ? (
                  <div className="grid gap-5 lg:grid-cols-2">
                    {workspace.packages.map((pkg) => (
                      <PackageCard
                        key={pkg.substation.id}
                        pkg={pkg}
                        canAssign={workspace.canAssign}
                        teams={workspace.assignableTeams}
                        busy={isAssigning}
                        onAssign={handleAssign}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center">
                    <Wrench size={22} className="mx-auto text-slate-400" />
                    <p className="mt-3 text-sm font-semibold text-slate-900">No routed defects</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Packages appear here as open defects are routed to the maintenance pool.
                    </p>
                  </div>
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
