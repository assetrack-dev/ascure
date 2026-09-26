"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Card,
  Chip,
  Eyebrow,
  FilterBar,
  IconBtn,
  KpiCard,
  PageHeader,
  SearchField,
  Seg,
  Tbtn,
  filterControlClass,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
  type Tone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  assignEmergency,
  assignMaintenancePackage,
  fetchMaintenancePackageBoard,
  withdrawMaintenancePackage,
} from "@/lib/maintenance-packages";
import type { AuthSession } from "@/types/auth";
import type {
  MaintenanceCategory,
  MaintenancePackageBoard,
  MaintenancePackageRecord,
  PackageCompany,
  PackagePencawang,
  RoutingResult,
} from "@/types/maintenance-packages";

const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  RENTIS: "Rentis",
  CAT_TIANG: "Cat tiang",
  SELENGGARAAN: "Selenggaraan",
};

type StatusFilter = "ALL" | "AWAITING" | "ASSIGNED";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "AWAITING", label: "Awaiting company" },
  { value: "ASSIGNED", label: "Assigned" },
] as const;

const modalInputClass = `${filterControlClass} mt-1.5 w-full`;
const modalSelectClass = `${filterSelectClass} mt-1.5 w-full`;
const modalLabelClass = "text-[12.5px] font-semibold text-[var(--foreground-soft)]";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function pencawangLabel(row: { pencawangName: string | null; pencawangCode: string | null }) {
  return row.pencawangName || row.pencawangCode || "Unnamed Pencawang";
}

function severityTone(severity: string): Tone {
  const normalized = severity.toUpperCase();
  if (normalized === "CRITICAL") return "critical";
  if (normalized === "HIGH") return "high";
  if (normalized === "MEDIUM") return "warning";
  return "neutral";
}

/** One line describing who owns the PE: whole company, split, or nobody yet. */
function assignmentSummary(row: PackagePencawang): { text: string; tone: Tone } {
  if (row.packages.length === 0) {
    return { text: "Awaiting company", tone: "warning" };
  }
  const whole = row.packages.find((pkg) => pkg.category === null);
  if (whole) {
    return { text: whole.organization.name, tone: "brand" };
  }
  const companies = new Set(row.packages.map((pkg) => pkg.organization.id));
  return {
    text: companies.size === 1 ? row.packages[0].organization.name : `Split · ${companies.size} companies`,
    tone: "brand",
  };
}

function routingMessage(result: RoutingResult) {
  const parts = [];
  if (result.routed) parts.push(`${result.routed} routed`);
  if (result.moved) parts.push(`${result.moved} moved`);
  if (result.kept) parts.push(`${result.kept} kept with the previous company (work already started)`);
  return parts.length > 0 ? `Saved — ${parts.join(", ")}.` : "Saved — no Kejanggalan changed hands.";
}

function companyLabel(company: PackageCompany) {
  return company.code ? `${company.name} (${company.code})` : company.name;
}

interface AssignDialogProps {
  row: PackagePencawang;
  companies: PackageCompany[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: {
    category: MaintenanceCategory | null;
    maintenanceOrganizationId: string;
    dueDate: string | null;
    notes: string | null;
  }) => void;
  onWithdraw: (pkg: MaintenancePackageRecord) => void;
}

function AssignDialog({ row, companies, busy, error, onClose, onSubmit, onWithdraw }: AssignDialogProps) {
  const lanesWithWork = row.lanes.filter((lane) => lane.total > 0);
  const whole = row.packages.find((pkg) => pkg.category === null) ?? null;
  const [scope, setScope] = useState<"WHOLE" | "LANE">(
    row.packages.length > 0 && !whole ? "LANE" : "WHOLE",
  );
  const [category, setCategory] = useState<MaintenanceCategory>(
    lanesWithWork[0]?.category ?? "SELENGGARAAN",
  );
  const existing =
    scope === "WHOLE" ? whole : row.packages.find((pkg) => pkg.category === category) ?? null;
  // A lane split off a whole package starts from the whole package's values.
  const defaults = existing ?? whole;
  const [companyId, setCompanyId] = useState(
    defaults?.organization.id ?? row.suggestedOrganizationId ?? "",
  );
  const [dueDate, setDueDate] = useState(defaults?.dueDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(defaults?.notes ?? "");

  // Switching whole ↔ lane (or lane) reloads that package's current values.
  useEffect(() => {
    setCompanyId(defaults?.organization.id ?? row.suggestedOrganizationId ?? "");
    setDueDate(defaults?.dueDate?.slice(0, 10) ?? "");
    setNotes(defaults?.notes ?? "");
  }, [defaults, row.suggestedOrganizationId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!companyId) {
      return;
    }
    onSubmit({
      category: scope === "WHOLE" ? null : category,
      maintenanceOrganizationId: companyId,
      dueDate: dueDate || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] px-[18px] py-4">
          <div className="min-w-0">
            <Eyebrow>{row.mainhead?.name ?? "No Mainhead"}</Eyebrow>
            <h2
              className="mt-1 truncate text-[18px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {pencawangLabel(row)}
            </h2>
            <p className="mt-1 text-[12.5px] text-[var(--muted)]">
              {row.totals.open} open Kejanggalan on {row.poleCount} pole{row.poleCount === 1 ? "" : "s"}
            </p>
          </div>
          <IconBtn onClick={onClose} aria-label="Close assign dialog">
            <X size={16} />
          </IconBtn>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-[18px] py-5">
          {error ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          <div>
            <span className={modalLabelClass}>Assign</span>
            <div className="mt-1.5">
              <Seg
                aria-label="Package scope"
                options={[
                  { value: "WHOLE", label: "Whole Pencawang" },
                  { value: "LANE", label: "One work type" },
                ]}
                value={scope}
                onChange={setScope}
              />
            </div>
          </div>

          {scope === "LANE" ? (
            <label className="block">
              <span className={modalLabelClass}>Work type</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as MaintenanceCategory)}
                className={modalSelectClass}
              >
                {lanesWithWork.map((lane) => (
                  <option key={lane.category} value={lane.category}>
                    {CATEGORY_LABEL[lane.category]} — {lane.open} open
                  </option>
                ))}
              </select>
              {whole ? (
                <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
                  The other work types stay with {whole.organization.name}.
                </span>
              ) : null}
            </label>
          ) : row.packages.length > 0 && !whole ? (
            <p className="text-[12px] text-[var(--muted)]">
              This replaces the current per-work-type split with one company for the whole Pencawang.
            </p>
          ) : null}

          <label className="block">
            <span className={modalLabelClass}>Maintenance company</span>
            <select
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              className={modalSelectClass}
              required
            >
              <option value="">Choose a company…</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {companyLabel(company)}
                  {company.id === row.suggestedOrganizationId ? " — Mainhead default" : ""}
                </option>
              ))}
            </select>
            {existing && companyId && companyId !== existing.organization.id ? (
              <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
                Kejanggalan the current company has already photographed stay with them; the rest
                move.
              </span>
            ) : null}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={modalLabelClass}>Target date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className={modalInputClass}
              />
            </label>
          </div>

          <label className="block">
            <span className={modalLabelClass}>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={`${modalInputClass} min-h-[72px] py-2`}
              maxLength={1000}
            />
          </label>

          {row.packages.length > 0 ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3">
              <p className="text-[12px] font-semibold text-[var(--foreground-soft)]">Current packages</p>
              <ul className="mt-2 space-y-1.5">
                {row.packages.map((pkg) => (
                  <li key={pkg.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate text-[var(--foreground-soft)]">
                      <span className="font-semibold">
                        {pkg.category ? CATEGORY_LABEL[pkg.category] : "Whole Pencawang"}
                      </span>{" "}
                      → {pkg.organization.name}
                      {pkg.dueDate ? ` · by ${formatDate(pkg.dueDate)}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => onWithdraw(pkg)}
                      disabled={busy}
                      className="shrink-0 text-[12px] font-semibold text-[var(--critical-text)] hover:underline disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-[var(--line2)] pt-4">
            <Tbtn type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Tbtn>
            <Tbtn type="submit" variant="primary" disabled={busy || !companyId}>
              {busy ? "Saving…" : existing ? "Save assignment" : "Assign"}
            </Tbtn>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmergencyQueue({
  board,
  busy,
  onAssign,
}: {
  board: MaintenancePackageBoard;
  busy: boolean;
  onAssign: (defectId: string, companyId: string) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});

  if (board.emergencies.length === 0) {
    return null;
  }

  return (
    <Card padded={false} className="border-[var(--critical-border)]">
      <div className="flex items-center gap-2 border-b border-[var(--line2)] px-4 py-3">
        <AlertTriangle size={16} className="text-[var(--critical-text)]" />
        <p className="text-[13px] font-semibold text-[var(--foreground)]">
          Emergencies without a company ({board.emergencies.length})
        </p>
      </div>
      <ul className="divide-y divide-[var(--line2)]">
        {board.emergencies.map((emergency) => (
          <li key={emergency.defectId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={severityTone(emergency.severity)}>{emergency.severity}</Chip>
                <span className="text-[13px] font-semibold text-[var(--foreground)]">
                  {emergency.remark || emergency.label}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {emergency.asset.assetCode} · {pencawangLabel(emergency)} ·{" "}
                {emergency.mainhead?.name ?? "No Mainhead"} · {formatDate(emergency.createdAt)}
              </p>
            </div>
            {board.canAssign ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Company for this emergency"
                  value={picked[emergency.defectId] ?? ""}
                  onChange={(event) =>
                    setPicked((current) => ({ ...current, [emergency.defectId]: event.target.value }))
                  }
                  className={filterSelectClass}
                >
                  <option value="">Choose company…</option>
                  {board.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {companyLabel(company)}
                    </option>
                  ))}
                </select>
                <Tbtn
                  variant="danger"
                  disabled={busy || !picked[emergency.defectId]}
                  onClick={() => onAssign(emergency.defectId, picked[emergency.defectId])}
                >
                  Assign
                </Tbtn>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MaintenancePackagesContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [board, setBoard] = useState<MaintenancePackageBoard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogRow, setDialogRow] = useState<PackagePencawang | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [withdrawTarget, setWithdrawTarget] = useState<MaintenancePackageRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [mainheadFilter, setMainheadFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadBoard = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        setBoard(await fetchMaintenancePackageBoard(token));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load packages.");
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (storedSession?.token) {
      void loadBoard(storedSession.token);
    }
  }, [loadBoard]);

  /** Runs a write, then reloads the board; errors land in the dialog when open. */
  const runWrite = useCallback(
    async (write: (token: string) => Promise<string>) => {
      const token = session?.token;
      if (!token) {
        return false;
      }
      setIsSaving(true);
      setDialogError("");
      setError("");
      try {
        setNotice(await write(token));
        await loadBoard(token);
        return true;
      } catch (writeError) {
        if (writeError instanceof ApiError && writeError.status === 401) {
          handleLogout();
          return false;
        }
        const message = writeError instanceof Error ? writeError.message : "Unable to save.";
        if (dialogRow) {
          setDialogError(message);
        } else {
          setError(message);
        }
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [dialogRow, handleLogout, loadBoard, session?.token],
  );

  const mainheads = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of board?.pencawangs ?? []) {
      if (row.mainhead) {
        byId.set(row.mainhead.id, row.mainhead.name);
      }
    }
    return [...byId.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [board]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (board?.pencawangs ?? []).filter((row) => {
      if (statusFilter === "AWAITING" && row.packages.length > 0) return false;
      if (statusFilter === "ASSIGNED" && row.packages.length === 0) return false;
      if (mainheadFilter !== "ALL" && row.mainhead?.id !== mainheadFilter) return false;
      if (!query) return true;
      return [row.pencawangName, row.pencawangCode, row.mainhead?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [board, mainheadFilter, search, statusFilter]);

  const kpis = useMemo(() => {
    const pencawangs = board?.pencawangs ?? [];
    return {
      awaiting: pencawangs.filter((row) => row.packages.length === 0).length,
      assigned: pencawangs.filter((row) => row.packages.length > 0).length,
      open: pencawangs.reduce((sum, row) => sum + row.totals.open, 0),
      unrouted: pencawangs.reduce((sum, row) => sum + row.totals.unrouted, 0),
    };
  }, [board]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Maintenance"
            title="Maintenance packages"
            subtitle="Hand each surveyed Pencawang to a maintenance company once its report is complete — whole, or split by work type. The company then assigns its own teams."
            chips={
              board ? (
                <Chip tone={board.canAssign ? "brand" : "neutral"}>
                  {board.canAssign ? "Can assign" : "View only"}
                </Chip>
              ) : null
            }
            actions={
              <Tbtn
                onClick={() => (session?.token ? loadBoard(session.token) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6 space-y-6">
            {notice ? (
              <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-[13px] text-[var(--foreground-soft)]">
                {notice}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-4 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : null}

            {board ? (
              <>
                <EmergencyQueue
                  board={board}
                  busy={isSaving}
                  onAssign={(defectId, companyId) =>
                    void runWrite(async (token) => {
                      await assignEmergency(token, defectId, companyId);
                      return "Emergency routed.";
                    })
                  }
                />

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard
                    label="Awaiting company"
                    value={kpis.awaiting.toLocaleString()}
                    icon={PackageOpen}
                    tone={kpis.awaiting > 0 ? "high" : "neutral"}
                    context="Report complete, no package yet"
                  />
                  <KpiCard
                    label="Assigned"
                    value={kpis.assigned.toLocaleString()}
                    icon={PackageCheck}
                    context="Pencawang with a company"
                  />
                  <KpiCard
                    label="Open Kejanggalan"
                    value={kpis.open.toLocaleString()}
                    icon={Building2}
                    context="Not yet repaired"
                  />
                  <KpiCard
                    label="Without a company"
                    value={kpis.unrouted.toLocaleString()}
                    icon={CalendarClock}
                    tone={kpis.unrouted > 0 ? "warning" : "neutral"}
                    context="Open Kejanggalan not routed"
                  />
                </div>

                <FilterBar>
                  <SearchField
                    placeholder="Search Pencawang or Mainhead"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <select
                    aria-label="Mainhead"
                    value={mainheadFilter}
                    onChange={(event) => setMainheadFilter(event.target.value)}
                    className={filterSelectClass}
                  >
                    <option value="ALL">All Mainheads</option>
                    {mainheads.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <Seg
                    aria-label="Assignment status"
                    options={STATUS_OPTIONS}
                    value={statusFilter}
                    onChange={setStatusFilter}
                  />
                </FilterBar>

                <Card padded={false}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] border-collapse">
                      <thead className={tableHeadClass}>
                        <tr>
                          <th className={tableHeadCellClass}>Pencawang</th>
                          <th className={tableHeadCellClass}>Report</th>
                          <th className={tableHeadCellClass}>Kejanggalan</th>
                          <th className={tableHeadCellClass}>Work types</th>
                          <th className={tableHeadCellClass}>Company</th>
                          <th className={tableHeadCellClass}>Target</th>
                          <th className={tableHeadCellClass} aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const summary = assignmentSummary(row);
                          const dueDates = [
                            ...new Set(row.packages.map((pkg) => pkg.dueDate).filter(Boolean)),
                          ] as string[];
                          return (
                            <tr key={row.siteVisitId} className={tableRowClass}>
                              <td className={tableCellClass}>
                                <div className="font-semibold text-[var(--foreground)]">
                                  {pencawangLabel(row)}
                                </div>
                                <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                                  {row.mainhead?.name ?? "No Mainhead"}
                                  {row.cycleNumber ? ` · Cycle ${row.cycleNumber}` : ""}
                                  {row.operationalScope ? ` · ${row.operationalScope}` : ""}
                                </div>
                              </td>
                              <td className={`${tableCellClass} whitespace-nowrap`}>
                                {formatDate(row.laporanSelesaiAt)}
                              </td>
                              <td className={`${tableCellClass} whitespace-nowrap`}>
                                <span className="font-semibold text-[var(--foreground)]">
                                  {row.totals.open}
                                </span>{" "}
                                open / {row.totals.total}
                                <div className="text-[12px] text-[var(--muted)]">
                                  {row.poleCount} pole{row.poleCount === 1 ? "" : "s"}
                                </div>
                              </td>
                              <td className={tableCellClass}>
                                <div className="flex flex-wrap gap-1.5">
                                  {row.lanes
                                    .filter((lane) => lane.total > 0)
                                    .map((lane) => (
                                      <Chip
                                        key={lane.category}
                                        tone={lane.organization ? "neutral" : "warning"}
                                        title={lane.organization?.name ?? "No company yet"}
                                      >
                                        {CATEGORY_LABEL[lane.category]} {lane.open}
                                      </Chip>
                                    ))}
                                </div>
                              </td>
                              <td className={tableCellClass}>
                                <Chip tone={summary.tone}>{summary.text}</Chip>
                              </td>
                              <td className={`${tableCellClass} whitespace-nowrap`}>
                                {dueDates.length === 0
                                  ? "—"
                                  : dueDates.length === 1
                                    ? formatDate(dueDates[0])
                                    : "Varies"}
                              </td>
                              <td className={`${tableCellClass} text-right`}>
                                {board.canAssign ? (
                                  <Tbtn
                                    variant={row.packages.length === 0 ? "primary" : "secondary"}
                                    onClick={() => {
                                      setDialogError("");
                                      setDialogRow(row);
                                    }}
                                  >
                                    {row.packages.length === 0 ? "Assign" : "Manage"}
                                  </Tbtn>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-12 text-center text-[13px] text-[var(--muted)]">
                              {board.pencawangs.length === 0
                                ? "No Pencawang has a completed survey report with Kejanggalan yet."
                                : "No Pencawang match these filters."}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : isLoading ? (
              <Card className="px-5 py-12 text-center text-[13px] text-[var(--muted)]">
                Loading packages…
              </Card>
            ) : null}
          </div>
        </div>
      </main>

      {dialogRow && board ? (
        <AssignDialog
          key={dialogRow.siteVisitId}
          row={board.pencawangs.find((row) => row.siteVisitId === dialogRow.siteVisitId) ?? dialogRow}
          companies={board.companies}
          busy={isSaving}
          error={dialogError}
          onClose={() => (isSaving ? undefined : setDialogRow(null))}
          onWithdraw={setWithdrawTarget}
          onSubmit={(input) =>
            void runWrite(async (token) => {
              const result = await assignMaintenancePackage(token, {
                siteVisitId: dialogRow.siteVisitId,
                ...input,
              });
              return routingMessage(result.routing);
            }).then((ok) => {
              if (ok) setDialogRow(null);
            })
          }
        />
      ) : null}

      <ConfirmDialog
        open={withdrawTarget !== null}
        title="Withdraw package?"
        message={
          withdrawTarget
            ? `Kejanggalan ${withdrawTarget.organization.name} has not started return to the unassigned list. Work already photographed stays with them.`
            : ""
        }
        confirmLabel="Withdraw"
        tone="danger"
        isBusy={isSaving}
        onCancel={() => setWithdrawTarget(null)}
        onConfirm={() => {
          const target = withdrawTarget;
          if (!target) return;
          void runWrite(async (token) => {
            const result = await withdrawMaintenancePackage(token, target.id);
            return routingMessage(result.routing);
          }).then(() => setWithdrawTarget(null));
        }}
      />
    </AppShell>
  );
}

export function MaintenancePackagesClient() {
  return (
    <AuthGuard>
      <MaintenancePackagesContent />
    </AuthGuard>
  );
}
