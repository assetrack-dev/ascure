"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, RefreshCw, X } from "lucide-react";
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
  fetchVerificationQueue,
  reassignCannotRepair,
  rejectRepair,
  reopenRepair,
  verifyRepair,
} from "@/lib/maintenance-verification";
import type { AuthSession } from "@/types/auth";
import type {
  RepairEvidence,
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
  { key: "BEFORE", label: "Before" },
  { key: "DURING", label: "During" },
  { key: "AFTER", label: "After" },
  { key: "OTHER", label: "Other photos" },
];

function evidenceGroup(image: RepairEvidence) {
  const type = image.evidenceType.toUpperCase();
  return type === "BEFORE" || type === "DURING" || type === "AFTER" ? type : "OTHER";
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
        <div className="flex flex-wrap gap-2">
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

function MaintenanceVerificationContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tab, setTab] = useState<VerificationTab>("PENDING");
  const [queue, setQueue] = useState<VerificationQueue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<{ kind: ActionKind; item: VerificationItem } | null>(null);
  const [actionError, setActionError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadQueue = useCallback(
    async (token: string, nextTab: VerificationTab) => {
      setIsLoading(true);
      setError("");
      try {
        setQueue(await fetchVerificationQueue(token, nextTab));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load repairs.");
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
      void loadQueue(storedSession.token, tab);
    }
  }, [loadQueue, tab]);

  const tabOptions = useMemo(
    () => [
      { value: "PENDING" as const, label: `Awaiting verification${queue ? ` (${queue.counts.pending})` : ""}` },
      { value: "CANNOT_REPAIR" as const, label: `Cannot repair${queue ? ` (${queue.counts.cannotRepair})` : ""}` },
      { value: "CLOSED" as const, label: "Closed" },
    ],
    [queue],
  );

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
      await loadQueue(token, tab);
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

  const roleChip = queue
    ? queue.actor.kind === "MAIN_CONTRACTOR"
      ? "Main contractor"
      : queue.actor.canVerify
        ? queue.actor.kind === "TNB"
          ? "TNB — can act"
          : "Admin"
        : "View only"
    : null;

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Maintenance"
            title="Repair verification"
            subtitle="Check each repair against its before / after photos, then verify it, send it back to the crew, or — for items the crew could not repair — decide what happens next."
            chips={roleChip ? <Chip tone={queue?.actor.canVerify ? "brand" : "neutral"}>{roleChip}</Chip> : null}
            actions={
              <Tbtn
                onClick={() => (session?.token ? loadQueue(session.token, tab) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6 space-y-4">
            <Seg aria-label="Verification tab" options={tabOptions} value={tab} onChange={setTab} />

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

            {queue && queue.tab === tab ? (
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
                <Card className="px-5 py-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]">
                    <ClipboardCheck size={20} />
                  </div>
                  <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">Nothing here</p>
                  <p className="mt-1 text-[12.5px] text-[var(--muted)]">
                    {tab === "CLOSED"
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
