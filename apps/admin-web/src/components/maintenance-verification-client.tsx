"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ClipboardCheck, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  EvidenceImageGrid,
  buildEvidenceEntries,
} from "@/components/inspection-evidence-grid";
import {
  Card,
  Chip,
  Eyebrow,
  IconBtn,
  PageHeader,
  Seg,
  Tbtn,
  filterControlClass,
  filterSelectClass,
  type Tone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  fetchVerificationGroups,
  fetchVerificationQueue,
  reassignCannotRepair,
  rejectRepair,
  reopenRepair,
  verifyRepair,
} from "@/lib/maintenance-verification";
import type { AuthSession } from "@/types/auth";
import type {
  RepairEvidence,
  VerificationFilters,
  VerificationGroup,
  VerificationGroups,
  VerificationItem,
  VerificationQueue,
  VerificationTab,
} from "@/types/maintenance-verification";

type ActionKind = "VERIFY" | "CLOSE_NOT_REPAIRABLE" | "REJECT" | "REOPEN" | "REASSIGN";

const ACTION_META: Record<
  ActionKind,
  { title: string; confirm: string; reasonLabel: string; reasonRequired: boolean; danger?: boolean }
> = {
  VERIFY: { title: "Verify repair", confirm: "Verify & close", reasonLabel: "Notes (optional)", reasonRequired: false },
  CLOSE_NOT_REPAIRABLE: {
    title: "Close as not repairable",
    confirm: "Close",
    reasonLabel: "Notes (optional)",
    reasonRequired: false,
  },
  REJECT: { title: "Send back to crew", confirm: "Send back", reasonLabel: "What must be fixed?", reasonRequired: true, danger: true },
  REOPEN: { title: "Re-open Kejanggalan", confirm: "Re-open", reasonLabel: "Why re-open?", reasonRequired: true, danger: true },
  REASSIGN: {
    title: "Hand to another company",
    confirm: "Hand over",
    reasonLabel: "Reason",
    reasonRequired: true,
  },
};

const OUTCOME_LABEL: Record<string, string> = {
  REPAIRED: "Repaired",
  RESOLVED: "Repaired",
  TEMPORARY_FIX: "Temporary fix",
  PARTIAL: "Partial",
  EXTERNAL_CONSTRAINT: "Cannot repair — external constraint",
  ESCALATED: "Cannot repair — escalated",
  DEFERRED: "Cannot repair — deferred",
  MONITOR_ONLY: "Monitor only",
  MONITORING_REQUIRED: "Monitoring required",
  DUPLICATE: "Duplicate",
  FALSE_POSITIVE: "False positive",
};

const CATEGORY_LABEL: Record<string, string> = {
  RENTIS: "Rentis",
  CAT_TIANG: "Cat tiang",
  SELENGGARAAN: "Selenggaraan",
};

/** Before → During → After, then anything else the crew uploaded. */
const EVIDENCE_GROUPS: Array<{ key: string; label: string }> = [
  // New finding (§13): the condition photo the office attached when adding it.
  { key: "FINDING", label: "Reported condition" },
  { key: "BEFORE", label: "Before" },
  { key: "DURING", label: "During" },
  { key: "AFTER", label: "After" },
  { key: "OTHER", label: "Other photos" },
];

function evidenceGroup(image: RepairEvidence) {
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

function severityTone(severity: string): Tone {
  const normalized = severity.toUpperCase();
  if (normalized === "CRITICAL") return "critical";
  if (normalized === "HIGH") return "high";
  if (normalized === "MEDIUM") return "warning";
  return "neutral";
}

function ActionDialog({
  kind,
  item,
  companies,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  kind: ActionKind;
  item: VerificationItem;
  companies: VerificationQueue["companies"];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (text: string, companyId: string) => void;
}) {
  const meta = ACTION_META[kind];
  const [text, setText] = useState("");
  const [companyId, setCompanyId] = useState("");
  const ready =
    (!meta.reasonRequired || text.trim().length > 0) && (kind !== "REASSIGN" || companyId);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ready) onSubmit(text.trim(), companyId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] px-[18px] py-4">
          <div className="min-w-0">
            <Eyebrow>{item.asset.assetCode}</Eyebrow>
            <h2
              className="mt-1 text-[17px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {meta.title}
            </h2>
          </div>
          <IconBtn onClick={onClose} aria-label="Close">
            <X size={16} />
          </IconBtn>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-[18px] py-5">
          {error ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}
          {kind === "REASSIGN" ? (
            <label className="block">
              <span className="text-[12.5px] font-semibold text-[var(--foreground-soft)]">Company</span>
              <select
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                className={`${filterSelectClass} mt-1.5 w-full`}
              >
                <option value="">Choose a company…</option>
                {companies
                  .filter((company) => company.id !== item.company?.id)
                  .map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.code ? `${company.name} (${company.code})` : company.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="text-[12.5px] font-semibold text-[var(--foreground-soft)]">
              {meta.reasonLabel}
            </span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              className={`${filterControlClass} mt-1.5 min-h-[84px] w-full py-2`}
              maxLength={1000}
              required={meta.reasonRequired}
            />
          </label>
          <div className="flex justify-end gap-2 border-t border-[var(--line2)] pt-4">
            <Tbtn type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Tbtn>
            <Tbtn type="submit" variant={meta.danger ? "danger" : "primary"} disabled={busy || !ready}>
              {busy ? "Saving…" : meta.confirm}
            </Tbtn>
          </div>
        </form>
      </div>
    </div>
  );
}

function RepairCard({
  item,
  queue,
  onAction,
}: {
  item: VerificationItem;
  queue: VerificationQueue;
  onAction: (kind: ActionKind, item: VerificationItem) => void;
}) {
  const { actor } = queue;
  const grouped = EVIDENCE_GROUPS.map((group) => ({
    ...group,
    entries: buildEvidenceEntries(item.evidence.filter((image) => evidenceGroup(image) === group.key)),
  })).filter((group) => group.entries.length > 0 || group.key === "BEFORE" || group.key === "AFTER");
  const isClosed = item.lifecycleStatus === "CLOSED";
  const canDecide = item.cannotRepair ? actor.canDecideCannotRepair : actor.canVerify;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={severityTone(item.severity)}>{item.severity}</Chip>
            {item.isEmergency ? <Chip tone="critical">Emergency</Chip> : null}
            {item.isNewFinding ? (
              <Chip tone="high" title={item.addedBy ? `Added by ${item.addedBy.name} during maintenance` : undefined}>
                New finding · not in survey
              </Chip>
            ) : null}
            {item.category ? <Chip tone="neutral">{CATEGORY_LABEL[item.category] ?? item.category}</Chip> : null}
            {item.resolutionOutcome ? (
              <Chip tone={item.cannotRepair ? "high" : "success"}>
                {OUTCOME_LABEL[item.resolutionOutcome] ?? item.resolutionOutcome}
              </Chip>
            ) : null}
          </div>
          <h3 className="mt-2 text-[14px] font-semibold text-[var(--foreground)]">
            {item.remark || item.label}
          </h3>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            <span className="font-mono">{item.asset.assetCode}</span> ·{" "}
            {item.pencawangName || item.pencawangCode || "Unnamed Pencawang"} ·{" "}
            {item.mainhead?.name ?? "No Mainhead"}
          </p>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            {item.company?.name ?? "—"} · submitted {formatDateTime(item.maintainedAt)}
            {item.maintainedBy ? ` by ${item.maintainedBy.name}` : ""}
          </p>
          {isClosed ? (
            <p className="mt-1 text-[12.5px] text-[var(--muted)]">
              Closed {formatDateTime(item.closedAt)}
              {item.closedBy ? ` by ${item.closedBy.name}` : ""}
              {item.closureNotes ? ` — ${item.closureNotes}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
          {!isClosed && canDecide ? (
            item.cannotRepair ? (
              <>
                <Tbtn variant="primary" onClick={() => onAction("CLOSE_NOT_REPAIRABLE", item)}>
                  Close as not repairable
                </Tbtn>
                <Tbtn onClick={() => onAction("REASSIGN", item)}>Hand to another company</Tbtn>
                <Tbtn variant="danger" onClick={() => onAction("REJECT", item)}>
                  Send back
                </Tbtn>
              </>
            ) : (
              <>
                <Tbtn variant="primary" onClick={() => onAction("VERIFY", item)}>
                  Verify
                </Tbtn>
                <Tbtn variant="danger" onClick={() => onAction("REJECT", item)}>
                  Send back
                </Tbtn>
              </>
            )
          ) : null}
          {isClosed && actor.canReopen ? (
            <Tbtn variant="danger" onClick={() => onAction("REOPEN", item)}>
              Re-open
            </Tbtn>
          ) : null}
        </div>
      </div>

      {item.maintenanceNotes ? (
        <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-3 py-2 text-[12.5px] text-[var(--foreground-soft)]">
          {item.maintenanceNotes}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {grouped.map((group) => (
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
    </Card>
  );
}

function groupKey(group: Pick<VerificationGroup, "siteVisitId" | "company">) {
  return `${group.siteVisitId}|${group.company.id}`;
}

function waitingFor(iso: string | null) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

const EMPTY_FILTERS: VerificationFilters = { search: "", organizationId: "", category: "", from: "", to: "" };

function MaintenanceVerificationContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tab, setTab] = useState<VerificationTab>("PENDING");
  const [filters, setFilters] = useState<VerificationFilters>(EMPTY_FILTERS);
  // Search is applied a moment after typing stops.
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [groups, setGroups] = useState<VerificationGroups | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [queue, setQueue] = useState<VerificationQueue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<{ kind: ActionKind; item: VerificationItem } | null>(null);
  const [actionError, setActionError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
        setGroups(await fetchVerificationGroups(token, tab, filters, page));
      } catch (loadError) {
        fail(loadError, "Unable to load repairs.");
      } finally {
        setIsLoading(false);
      }
    },
    [fail, filters, page, tab],
  );

  const loadGroup = useCallback(
    async (token: string, key: string) => {
      const [siteVisitId, organizationId] = key.split("|");
      setIsLoadingGroup(true);
      try {
        setQueue(
          await fetchVerificationQueue(token, tab, {
            siteVisitId,
            organizationId,
            category: filters.category,
            from: filters.from,
            to: filters.to,
          }),
        );
      } catch (loadError) {
        fail(loadError, "Unable to load these repairs.");
      } finally {
        setIsLoadingGroup(false);
      }
    },
    [fail, filters.category, filters.from, filters.to, tab],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (storedSession?.token) {
      void loadGroups(storedSession.token);
    }
  }, [loadGroups]);

  // Typing settles → apply the search (back to page 1).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.search === searchInput ? current : { ...current, search: searchInput }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Tab / filters change → page 1, nothing open.
  useEffect(() => {
    setPage(0);
    setOpenKey(null);
    setQueue(null);
  }, [tab, filters]);

  const toggleGroup = (group: VerificationGroup) => {
    const key = groupKey(group);
    if (openKey === key) {
      setOpenKey(null);
      setQueue(null);
      return;
    }
    setOpenKey(key);
    setQueue(null);
    if (session?.token) void loadGroup(session.token, key);
  };

  const tabOptions = useMemo(
    () => [
      { value: "PENDING" as const, label: `Awaiting verification${groups ? ` (${groups.counts.pending})` : ""}` },
      { value: "CANNOT_REPAIR" as const, label: `Cannot repair${groups ? ` (${groups.counts.cannotRepair})` : ""}` },
      { value: "CLOSED" as const, label: "Closed" },
    ],
    [groups],
  );

  const activeFilterCount = [filters.organizationId, filters.category, filters.from, filters.to].filter(Boolean).length;
  const setFilter = (key: keyof VerificationFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const submitAction = async (text: string, companyId: string) => {
    const token = session?.token;
    if (!token || !action) return;
    setIsSaving(true);
    setActionError("");
    try {
      const { kind, item } = action;
      if (kind === "VERIFY" || kind === "CLOSE_NOT_REPAIRABLE") {
        await verifyRepair(token, item.id, text);
        setNotice(kind === "VERIFY" ? "Repair verified and closed." : "Closed as not repairable.");
      } else if (kind === "REJECT") {
        await rejectRepair(token, item.id, text);
        setNotice("Sent back to the crew.");
      } else if (kind === "REOPEN") {
        await reopenRepair(token, item.id, text);
        setNotice("Kejanggalan re-opened.");
      } else {
        await reassignCannotRepair(token, item.id, companyId, text);
        setNotice("Handed to the new company.");
      }
      setAction(null);
      // Refresh the open group and the group counts.
      await Promise.all([loadGroups(token), openKey ? loadGroup(token, openKey) : Promise.resolve()]);
    } catch (actionFailure) {
      if (actionFailure instanceof ApiError && actionFailure.status === 401) {
        handleLogout();
        return;
      }
      setActionError(actionFailure instanceof Error ? actionFailure.message : "Unable to save.");
    } finally {
      setIsSaving(false);
    }
  };

  const actor = groups?.actor ?? queue?.actor ?? null;
  const roleChip = actor
    ? actor.kind === "MAIN_CONTRACTOR"
      ? "Main contractor"
      : actor.canVerify
        ? actor.kind === "TNB"
          ? "TNB — can act"
          : "Admin"
        : "View only"
    : null;
  const pages = groups ? Math.max(1, Math.ceil(groups.totalGroups / groups.pageSize)) : 1;

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Maintenance"
            title="Repair verification"
            subtitle="Repairs grouped by Pencawang and company. Open a group, check each repair against its before / after photos, then verify it or send it back to the crew."
            chips={roleChip ? <Chip tone={actor?.canVerify ? "brand" : "neutral"}>{roleChip}</Chip> : null}
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
              <Seg aria-label="Verification tab" options={tabOptions} value={tab} onChange={setTab} />
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
              {/* Phones: folded behind the button above; md+: inline (plan §19, N49). */}
              <div className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-2.5 md:contents`}>
                <select
                  aria-label="Company"
                  value={filters.organizationId ?? ""}
                  onChange={(event) => setFilter("organizationId", event.target.value)}
                  className={filterSelectClass}
                >
                  <option value="">All companies</option>
                  {(groups?.companies ?? []).map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
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
                  {tab === "CLOSED" ? "Closed" : "Submitted"} from
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
                {activeFilterCount > 0 || searchInput ? (
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

            {groups && groups.tab === tab ? (
              groups.groups.length > 0 ? (
                <>
                  <p className="text-[12.5px] text-[var(--muted)]">
                    {groups.totalGroups.toLocaleString()} group{groups.totalGroups === 1 ? "" : "s"} · Pencawang +
                    company
                  </p>
                  <ul className="space-y-2.5">
                    {groups.groups.map((group) => {
                      const key = groupKey(group);
                      const isOpen = openKey === key;
                      const waiting = waitingFor(tab === "CLOSED" ? null : group.oldestAt);
                      return (
                        <li
                          key={key}
                          className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
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
                            {/* Phones: the name takes the first line, chips wrap below. */}
                            <div className="min-w-0 basis-[calc(100%-28px)] sm:flex-1 sm:basis-auto">
                              <p className="truncate text-[14px] font-semibold text-[var(--foreground)]">
                                {group.pencawangName || group.pencawangCode || "Unnamed Pencawang"}
                              </p>
                              <p className="truncate text-[12px] text-[var(--muted)]">
                                {group.company.name}
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
                              <Chip tone={tab === "CLOSED" ? "success" : "brand"}>
                                {group.count} {tab === "CLOSED" ? "closed" : "waiting"}
                              </Chip>
                              {waiting ? (
                                <span className="text-[12px] text-[var(--muted)]">oldest {waiting}</span>
                              ) : null}
                            </div>
                          </button>
                          {isOpen ? (
                            <div className="space-y-3 border-t border-[var(--line2)] bg-[var(--panel-muted)] p-3">
                              {queue && !isLoadingGroup ? (
                                queue.items.length > 0 ? (
                                  queue.items.map((item) => (
                                    <RepairCard
                                      key={item.id}
                                      item={item}
                                      queue={queue}
                                      onAction={(kind, target) => {
                                        setActionError("");
                                        setAction({ kind, item: target });
                                      }}
                                    />
                                  ))
                                ) : (
                                  <p className="px-1 py-3 text-[13px] text-[var(--muted)]">
                                    Nothing left in this group.
                                  </p>
                                )
                              ) : (
                                <p className="px-1 py-3 text-[13px] text-[var(--muted)]">Loading repairs…</p>
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
                    <ClipboardCheck size={20} />
                  </div>
                  <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">Nothing here</p>
                  <p className="mt-1 text-[12.5px] text-[var(--muted)]">
                    {activeFilterCount > 0 || filters.search
                      ? "No repairs match these filters."
                      : tab === "CLOSED"
                        ? "No closed Kejanggalan yet."
                        : "Repairs appear here once a crew submits them."}
                  </p>
                </Card>
              )
            ) : isLoading ? (
              <Card className="px-5 py-12 text-center text-[13px] text-[var(--muted)]">Loading…</Card>
            ) : null}
          </div>
        </div>
      </main>

      {action && queue ? (
        <ActionDialog
          kind={action.kind}
          item={action.item}
          companies={queue.companies}
          busy={isSaving}
          error={actionError}
          onClose={() => (isSaving ? undefined : setAction(null))}
          onSubmit={(text, companyId) => void submitAction(text, companyId)}
        />
      ) : null}
    </AppShell>
  );
}

export function MaintenanceVerificationClient() {
  return (
    <AuthGuard>
      <MaintenanceVerificationContent />
    </AuthGuard>
  );
}
