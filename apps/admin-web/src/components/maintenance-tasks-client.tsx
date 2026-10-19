"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ListChecks, RefreshCw, SlidersHorizontal, Undo2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { EvidenceImageGrid, buildEvidenceEntries } from "@/components/inspection-evidence-grid";
import {
  Card,
  Chip,
  PageHeader,
  Seg,
  Tbtn,
  filterControlClass,
  filterSelectClass,
  type Tone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchTaskGroups, fetchTaskItems } from "@/lib/maintenance-tasks";
import type { AuthSession } from "@/types/auth";
import {
  TASK_STATUS_ORDER,
  type TaskEvidence,
  type TaskFilters,
  type TaskGroup,
  type TaskGroups,
  type TaskItem,
  type TaskItems,
  type TaskStatus,
} from "@/types/maintenance-tasks";

/**
 * Plan §21.2 #4 — "My tasks": every Kejanggalan the company has been given, one
 * folded row per Pencawang + team, laid out like Repair Verification but showing
 * the whole life of the work. Sent-back work (with TNB's reason) comes first.
 * Read-only — the work itself is done on the phone / Maintenance Packages.
 */

const STATUS_META: Record<TaskStatus, { label: string; count: string; tone: Tone }> = {
  SENT_BACK: { label: "Sent back", count: "sent back", tone: "critical" },
  TODO: { label: "To do", count: "to do", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", count: "in progress", tone: "info" },
  COMPLETED: { label: "Completed on site", count: "waiting for TNB", tone: "brand" },
  CANNOT_REPAIR: { label: "Cannot repair", count: "cannot repair", tone: "high" },
  VERIFIED: { label: "Verified", count: "verified", tone: "success" },
};

const CATEGORY_LABEL: Record<string, string> = {
  RENTIS: "Rentis",
  CAT_TIANG: "Cat tiang",
  SELENGGARAAN: "Selenggaraan",
};

const OUTCOME_LABEL: Record<string, string> = {
  EXTERNAL_CONSTRAINT: "External constraint",
  ESCALATED: "Escalated",
  DEFERRED: "Deferred",
};

/** Before → During → After, then anything else the crew uploaded. */
const EVIDENCE_GROUPS: Array<{ key: string; label: string }> = [
  { key: "FINDING", label: "Reported condition" },
  { key: "BEFORE", label: "Before" },
  { key: "DURING", label: "During" },
  { key: "AFTER", label: "After" },
  { key: "OTHER", label: "Other photos" },
];

function evidenceGroup(image: TaskEvidence) {
  const type = image.evidenceType.toUpperCase();
  return type === "BEFORE" || type === "DURING" || type === "AFTER" || type === "FINDING" ? type : "OTHER";
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function isOverdue(item: TaskItem) {
  if (!item.dueDate) return false;
  if (item.status !== "TODO" && item.status !== "IN_PROGRESS" && item.status !== "SENT_BACK") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(item.dueDate).getTime() < today.getTime();
}

function groupKey(group: Pick<TaskGroup, "siteVisitId" | "company" | "team">) {
  return `${group.siteVisitId}|${group.company.id}|${group.team?.id ?? "NONE"}`;
}

function TaskCard({ item }: { item: TaskItem }) {
  const meta = STATUS_META[item.status];
  const photos = EVIDENCE_GROUPS.map((group) => ({
    ...group,
    entries: buildEvidenceEntries(item.evidence.filter((image) => evidenceGroup(image) === group.key)),
  })).filter((group) => group.entries.length > 0);
  const overdue = isOverdue(item);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={meta.tone}>{meta.label}</Chip>
        {item.isEmergency ? <Chip tone="critical">Emergency</Chip> : null}
        {item.isNewFinding ? <Chip tone="high">New finding · not in survey</Chip> : null}
        <Chip tone="neutral">{CATEGORY_LABEL[item.category] ?? item.category}</Chip>
        {item.repairMethod ? (
          <Chip tone="info" title={item.repairMethod.note ?? undefined}>
            {item.repairMethod.label}
            {item.repairMethod.note ? ` — ${item.repairMethod.note}` : ""}
          </Chip>
        ) : null}
        {item.status === "CANNOT_REPAIR" && item.resolutionOutcome ? (
          <Chip tone="high">{OUTCOME_LABEL[item.resolutionOutcome] ?? item.resolutionOutcome}</Chip>
        ) : null}
        {overdue ? <Chip tone="critical">Overdue</Chip> : null}
      </div>

      <h3 className="mt-2 text-[14px] font-semibold text-[var(--foreground)]">{item.remark || item.label}</h3>
      <p className="mt-1 text-[12.5px] text-[var(--muted)]">
        <span className="font-mono">{item.asset.assetCode}</span>
        {item.asset.noTiangLama ? (
          <>
            {" "}
            · Lama {item.asset.noTiangLama}
            {item.asset.noTiangLamaPrevious ? ` (dahulu: ${item.asset.noTiangLamaPrevious})` : ""}
          </>
        ) : null}
        {item.team ? ` · ${item.team.name}` : " · No team yet"}
      </p>

      {item.sentBack ? (
        // What the crew must fix — the reason TNB / the main contractor gave.
        <div className="mt-3 flex gap-2.5 rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2.5 text-[13px] text-[var(--critical-text)]">
          <Undo2 size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">{item.sentBack.reason ?? item.sentBack.comment ?? "Sent back"}</p>
            <p className="mt-0.5 text-[12px] opacity-85">
              Sent back {formatDateTime(item.sentBack.at)}
              {item.sentBack.by ? ` by ${item.sentBack.by.name}` : ""} · fix it and mark it done again.
            </p>
          </div>
        </div>
      ) : null}

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[var(--muted)]">Given to the company</dt>
          <dd className="text-[var(--foreground-soft)]">{formatDate(item.assignedAt)}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Target</dt>
          <dd className={overdue ? "font-semibold text-[var(--critical-text)]" : "text-[var(--foreground-soft)]"}>
            {formatDate(item.dueDate)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Marked done</dt>
          <dd className="text-[var(--foreground-soft)]">
            {formatDateTime(item.maintainedAt)}
            {item.maintainedAt && item.maintainedBy ? ` · ${item.maintainedBy.name}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Verified</dt>
          <dd className="text-[var(--foreground-soft)]">
            {formatDateTime(item.verifiedAt)}
            {item.verifiedAt && item.verifiedBy ? ` · ${item.verifiedBy.name}` : ""}
          </dd>
        </div>
      </dl>

      {item.maintenanceNotes ? (
        <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-3 py-2 text-[12.5px] text-[var(--foreground-soft)]">
          {item.maintenanceNotes}
        </p>
      ) : null}
      {item.verificationNotes ? (
        <p className="mt-2 text-[12.5px] text-[var(--muted)]">Verification note: {item.verificationNotes}</p>
      ) : null}

      {photos.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {photos.map((group) => (
            <div key={group.key}>
              <p className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
                {group.label}
              </p>
              <EvidenceImageGrid
                entries={group.entries}
                emptyText={`No ${group.label.toLowerCase()} photo`}
                titlePrefix={`${item.asset.assetCode} · ${group.label}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-[var(--muted)]">No repair photos yet.</p>
      )}
    </Card>
  );
}

const EMPTY_FILTERS: TaskFilters = {
  status: "",
  organizationId: "",
  teamId: "",
  category: "",
  from: "",
  to: "",
  search: "",
};

function MaintenanceTasksContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  // Search is applied a moment after typing stops.
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [groups, setGroups] = useState<TaskGroups | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [items, setItems] = useState<TaskItems | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const fail = useCallback(
    (loadError: unknown, fallback: string) => {
      if (loadError instanceof ApiError && loadError.status === 401) {
        handleLogout();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : fallback);
    },
    [handleLogout],
  );

  const loadGroups = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        setGroups(await fetchTaskGroups(token, filters, page));
      } catch (loadError) {
        fail(loadError, "Unable to load tasks.");
      } finally {
        setIsLoading(false);
      }
    },
    [fail, filters, page],
  );

  const loadGroup = useCallback(
    async (token: string, key: string) => {
      const [siteVisitId, organizationId, teamId] = key.split("|");
      setIsLoadingGroup(true);
      try {
        setItems(await fetchTaskItems(token, { siteVisitId, organizationId, teamId }, filters));
      } catch (loadError) {
        fail(loadError, "Unable to load these tasks.");
      } finally {
        setIsLoadingGroup(false);
      }
    },
    [fail, filters],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (storedSession?.token) void loadGroups(storedSession.token);
  }, [loadGroups]);

  // Typing settles → apply the search.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.search === searchInput ? current : { ...current, search: searchInput }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // The Overview links here pre-filtered: ?status= / ?teamId= / ?organizationId=.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status") ?? "";
    const preset = {
      status: (TASK_STATUS_ORDER as string[]).includes(status) ? (status as TaskStatus) : "",
      teamId: params.get("teamId") ?? "",
      organizationId: params.get("organizationId") ?? "",
    } as const;
    if (preset.status || preset.teamId || preset.organizationId) {
      setFilters((current) => ({ ...current, ...preset }));
    }
  }, []);

  // Filters change → page 1, nothing open.
  useEffect(() => {
    setPage(0);
    setOpenKey(null);
    setItems(null);
  }, [filters]);

  const toggleGroup = (group: TaskGroup) => {
    const key = groupKey(group);
    if (openKey === key) {
      setOpenKey(null);
      setItems(null);
      return;
    }
    setOpenKey(key);
    setItems(null);
    if (session?.token) void loadGroup(session.token, key);
  };

  const setFilter = (key: keyof TaskFilters, value: string) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      // The team list follows the company.
      ...(key === "organizationId" ? { teamId: "" } : {}),
    }));

  const total = groups ? Object.values(groups.counts).reduce((sum, count) => sum + count, 0) : 0;
  const statusOptions = useMemo(
    () => [
      { value: "" as const, label: `All${groups ? ` (${total})` : ""}` },
      ...TASK_STATUS_ORDER.map((status) => ({
        value: status,
        label: `${STATUS_META[status].label}${groups ? ` (${groups.counts[status]})` : ""}`,
      })),
    ],
    [groups, total],
  );
  const teams = (groups?.teams ?? []).filter(
    (team) => !filters.organizationId || team.organizationId === filters.organizationId,
  );
  const showCompany = (groups?.companies.length ?? 0) > 1;
  const activeFilterCount = [filters.organizationId, filters.teamId, filters.category, filters.from, filters.to].filter(
    Boolean,
  ).length;
  const pages = groups ? Math.max(1, Math.ceil(groups.totalGroups / groups.pageSize)) : 1;

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Maintenance"
            title="My tasks"
            subtitle="Every Kejanggalan your company has been given, by Pencawang and team: to do, in progress, completed on site, verified. Work TNB sent back is at the top with the reason."
            actions={
              <Tbtn
                onClick={() => (session?.token ? loadGroups(session.token) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6 space-y-4">
            <div className="overflow-x-auto">
              <Seg
                aria-label="Status"
                options={statusOptions}
                value={filters.status ?? ""}
                onChange={(value) => setFilter("status", value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search Pencawang"
                aria-label="Search Pencawang"
                className={`${filterControlClass} min-w-[200px] flex-1`}
              />
              <button
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
                className={`${filterControlClass} inline-flex items-center gap-1.5 font-semibold md:hidden`}
              >
                <SlidersHorizontal size={15} />
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </button>
              {/* Phones: folded behind the button above; md+: inline. */}
              <div className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-2.5 md:contents`}>
                {showCompany ? (
                  <select
                    aria-label="Company"
                    value={filters.organizationId ?? ""}
                    onChange={(event) => setFilter("organizationId", event.target.value)}
                    className={filterSelectClass}
                  >
                    <option value="">All companies</option>
                    {groups?.companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <select
                  aria-label="Team"
                  value={filters.teamId ?? ""}
                  onChange={(event) => setFilter("teamId", event.target.value)}
                  className={filterSelectClass}
                >
                  <option value="">All teams</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                  {groups?.hasNoTeam ? <option value="NONE">No team yet</option> : null}
                </select>
                <select
                  aria-label="Work type"
                  value={filters.category ?? ""}
                  onChange={(event) => setFilter("category", event.target.value)}
                  className={filterSelectClass}
                >
                  <option value="">All work types</option>
                  {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--muted)]">
                  Done or verified from
                  <input
                    type="date"
                    value={filters.from ?? ""}
                    onChange={(event) => setFilter("from", event.target.value)}
                    className={filterControlClass}
                  />
                </label>
                <label className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--muted)]">
                  to
                  <input
                    type="date"
                    value={filters.to ?? ""}
                    onChange={(event) => setFilter("to", event.target.value)}
                    className={filterControlClass}
                  />
                </label>
                {activeFilterCount > 0 || searchInput || filters.status ? (
                  <Tbtn
                    variant="ghost"
                    onClick={() => {
                      setSearchInput("");
                      setFilters(EMPTY_FILTERS);
                    }}
                  >
                    Clear
                  </Tbtn>
                ) : null}
              </div>
            </div>

            {error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-4 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : null}

            {groups ? (
              groups.groups.length > 0 ? (
                <>
                  <p className="text-[12.5px] text-[var(--muted)]">
                    {groups.totalGroups.toLocaleString()} group{groups.totalGroups === 1 ? "" : "s"} · Pencawang + team
                  </p>
                  <ul className="space-y-2.5">
                    {groups.groups.map((group) => {
                      const key = groupKey(group);
                      const isOpen = openKey === key;
                      return (
                        <li
                          key={key}
                          className={`overflow-hidden rounded-[var(--radius-card)] border bg-[var(--panel)] shadow-[var(--shadow-soft)] ${
                            group.counts.SENT_BACK > 0 ? "border-[var(--critical-border)]" : "border-[var(--line)]"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleGroup(group)}
                            aria-expanded={isOpen}
                            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left hover:bg-[var(--panel-muted)]"
                          >
                            <ChevronDown
                              size={16}
                              className={`shrink-0 text-[var(--muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
                            />
                            <div className="min-w-0 basis-[calc(100%-28px)] sm:flex-1 sm:basis-auto">
                              <p className="truncate text-[14px] font-semibold text-[var(--foreground)]">
                                {group.pencawangName || group.pencawangCode || "Unnamed Pencawang"}
                              </p>
                              <p className="truncate text-[12px] text-[var(--muted)]">
                                {group.team?.name ?? "No team yet"}
                                {showCompany ? ` · ${group.company.name}` : ""}
                                {group.mainhead ? ` · ${group.mainhead}` : ""}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 pl-7 sm:pl-0">
                              {group.emergencies > 0 ? (
                                <Chip tone="critical">
                                  <AlertTriangle size={12} className="shrink-0" />
                                  {group.emergencies} emergency
                                </Chip>
                              ) : null}
                              {group.categories.map((category) => (
                                <Chip key={category} tone="neutral">
                                  {CATEGORY_LABEL[category] ?? category}
                                </Chip>
                              ))}
                              {TASK_STATUS_ORDER.filter((status) => group.counts[status] > 0).map((status) => (
                                <Chip key={status} tone={STATUS_META[status].tone}>
                                  {group.counts[status]} {STATUS_META[status].count}
                                </Chip>
                              ))}
                            </div>
                          </button>
                          {isOpen ? (
                            <div className="space-y-3 border-t border-[var(--line2)] bg-[var(--panel-muted)] p-3">
                              {items && !isLoadingGroup ? (
                                items.items.length > 0 ? (
                                  <>
                                    {items.items.map((item) => (
                                      <TaskCard key={item.id} item={item} />
                                    ))}
                                    {items.truncated ? (
                                      <p className="px-1 text-[12.5px] text-[var(--muted)]">
                                        Showing the first 500. Narrow the filters to see the rest.
                                      </p>
                                    ) : null}
                                  </>
                                ) : (
                                  <p className="px-1 py-3 text-[13px] text-[var(--muted)]">
                                    Nothing here with these filters.
                                  </p>
                                )
                              ) : (
                                <p className="px-1 py-3 text-[13px] text-[var(--muted)]">Loading tasks…</p>
                              )}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {pages > 1 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-[var(--muted)]">
                      <span>
                        Page {page + 1} of {pages}
                      </span>
                      <div className="flex gap-2">
                        <Tbtn onClick={() => setPage(page - 1)} disabled={page === 0 || isLoading}>
                          Previous
                        </Tbtn>
                        <Tbtn onClick={() => setPage(page + 1)} disabled={page >= pages - 1 || isLoading}>
                          Next
                        </Tbtn>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <Card className="px-5 py-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]">
                    <ListChecks size={20} />
                  </div>
                  <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">Nothing here</p>
                  <p className="mt-1 text-[12.5px] text-[var(--muted)]">
                    {activeFilterCount > 0 || filters.search || filters.status
                      ? "No tasks match these filters."
                      : "Kejanggalan appear here once TNB or the main contractor gives your company a Pencawang."}
                  </p>
                </Card>
              )
            ) : isLoading ? (
              <Card className="px-5 py-12 text-center text-[13px] text-[var(--muted)]">Loading…</Card>
            ) : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function MaintenanceTasksClient() {
  return (
    <AuthGuard>
      <MaintenanceTasksContent />
    </AuthGuard>
  );
}
