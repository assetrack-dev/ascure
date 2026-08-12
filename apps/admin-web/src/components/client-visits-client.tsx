"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  CardHead,
  Chip,
  FilterBar,
  PageHeader,
  SearchField,
  Tbtn,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableMonoCellClass,
  tableRowClass,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { storeAssetNavContext } from "@/lib/asset-nav";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  formatClientDate,
  lifecycleLabel,
  lifecycleTone,
  poleStateChip,
  severityTone,
} from "@/lib/client-labels";
import {
  fetchClientMainheads,
  fetchClientVisit,
  fetchClientVisits,
  type ClientPole,
  type ClientSurvey,
  type ClientVisitDetail,
} from "@/lib/client-progress";
import type { AuthSession } from "@/types/auth";

/**
 * The network owner's (TNB) survey feed: every survey walked on their assigned
 * Mainheads, at EVERY lifecycle stage, and the poles behind each one.
 *
 * ⚠ READ-ONLY by construction — this view only ever calls `/client/*` GETs, and
 * a CLIENT holds none of ADMIN / canGovernQa / canReviewSurvey, so the pages it
 * links into (the asset detail) render without their action controls.
 *
 * ⚠ NO ATTRIBUTION: which contractor walked a survey is deliberately absent
 * (owner's call, 2026-08-10). The API doesn't send it — don't add it here.
 */

type StageFilter = "ALL" | "IN_FIELD" | "FINISHED";

const STAGE_OPTIONS: { value: StageFilter; label: string }[] = [
  { value: "ALL", label: "All stages" },
  { value: "IN_FIELD", label: "In field" },
  { value: "FINISHED", label: "Completed" },
];

/** One pole row, shared by the visit drill-down. */
function PoleRow({
  pole,
  onOpen,
}: {
  pole: ClientPole;
  onOpen: () => void;
}) {
  const state = poleStateChip(pole);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-[var(--line2)] px-[18px] py-3 text-left transition last:border-b-0 hover:bg-[var(--panel-muted)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[13px] font-semibold text-[var(--foreground)]">
          {pole.assetCode}
        </span>
        {/* The chip already says "Not surveyed" — show the pole's name there
            instead of repeating it. */}
        {pole.surveyState === "SURVEYED" ? (
          <span className="block text-[11.5px] text-[var(--muted)]">
            {formatClientDate(pole.inspectedAt)} · {pole.photoCount} photo
            {pole.photoCount === 1 ? "" : "s"}
          </span>
        ) : pole.name ? (
          <span className="block truncate text-[11.5px] text-[var(--muted)]">
            {pole.name}
          </span>
        ) : null}
      </span>
      <Chip tone={state.tone}>{state.label}</Chip>
      {pole.defects.length > 0 ? (
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {pole.defects.slice(0, 2).map((defect) => (
            <Chip key={defect.id} tone={severityTone(defect.severity)}>
              {defect.severity ?? "DEFECT"}
            </Chip>
          ))}
          {pole.defects.length > 2 ? (
            <Chip tone="neutral">+{pole.defects.length - 2}</Chip>
          ) : null}
        </span>
      ) : pole.surveyState === "SURVEYED" ? (
        <span className="shrink-0 text-[11.5px] text-[var(--success-text)]">
          No defects
        </span>
      ) : null}
      <ChevronRight size={15} className="shrink-0 text-[var(--muted-2)]" />
    </button>
  );
}

function ClientVisitsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [visits, setVisits] = useState<ClientSurvey[]>([]);
  const [visitTotal, setVisitTotal] = useState(0);
  const [mainheads, setMainheads] = useState<{ id: string; name: string }[]>([]);
  const [detail, setDetail] = useState<ClientVisitDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<StageFilter>("ALL");
  const [mainheadId, setMainheadId] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const load = useCallback(
    async (token: string, targetMainheadId: string) => {
      setIsLoading(true);
      setError("");
      try {
        const [list, nextMainheads] = await Promise.all([
          fetchClientVisits(token, targetMainheadId || undefined),
          fetchClientMainheads(token),
        ]);
        setVisits(list.visits);
        setVisitTotal(list.total);
        setMainheads(nextMainheads);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load surveys.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (stored?.token) {
      void load(stored.token, "");
    } else {
      setIsLoading(false);
    }
  }, [load]);

  const openVisit = useCallback(
    async (visit: ClientSurvey) => {
      if (!session?.token) return;
      setIsLoading(true);
      setError("");
      try {
        setDetail(await fetchClientVisit(session.token, visit.id));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load this survey.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [session?.token, handleLogout],
  );

  const openPole = useCallback(
    (poles: ClientPole[], pole: ClientPole) => {
      // Stash the survey's pole order so the detail page can step Prev/Next.
      storeAssetNavContext(
        poles.map((row) => row.id),
        "/visits",
        pole.id,
      );
      router.push(
        `/assets/${encodeURIComponent(pole.id)}?from=${encodeURIComponent("/visits")}`,
      );
    },
    [router],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return visits.filter((visit) => {
      if (stage === "IN_FIELD" && visit.isFinished) return false;
      if (stage === "FINISHED" && !visit.isFinished) return false;
      if (!needle) return true;
      return (
        visit.pencawang.toLowerCase().includes(needle) ||
        visit.mainhead.toLowerCase().includes(needle)
      );
    });
  }, [visits, search, stage]);

  const summary = useMemo(
    () => ({
      inField: visits.filter((visit) => !visit.isFinished).length,
      finished: visits.filter((visit) => visit.isFinished).length,
      openDefects: visits.reduce((sum, visit) => sum + visit.openDefects, 0),
    }),
    [visits],
  );

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-4">
          <PageHeader
            eyebrow="Surveys"
            title={
              detail ? detail.visit.pencawang : "Surveys on your network"
            }
            subtitle={
              detail
                ? `${detail.visit.mainhead} · ${lifecycleLabel(detail.visit.lifecycleStatus)} · started ${formatClientDate(detail.visit.startedAt)}`
                : "Every survey walked on your assigned Mainheads — including the ones still in the field."
            }
            chips={
              detail ? null : (
                <>
                  <Chip tone="brand" dot>
                    {summary.inField} in field
                  </Chip>
                  <Chip tone="success" dot>
                    {summary.finished} completed
                  </Chip>
                  {/* The "N urgent" chip is hidden until the emergency system's
                      rollout completes (docs/tnb-view-emergency-hidden.md). */}
                  {summary.openDefects > 0 ? (
                    <Chip tone="high" dot>
                      {summary.openDefects.toLocaleString()} open findings
                    </Chip>
                  ) : null}
                </>
              )
            }
            actions={
              detail ? (
                <Tbtn onClick={() => setDetail(null)}>
                  <ChevronLeft size={14} />
                  All surveys
                </Tbtn>
              ) : (
                <Tbtn
                  onClick={() =>
                    session?.token ? load(session.token, mainheadId) : undefined
                  }
                  disabled={isLoading || !session?.token}
                >
                  <RefreshCw
                    size={15}
                    className={isLoading ? "animate-spin" : ""}
                  />
                  Refresh
                </Tbtn>
              )
            }
          />

          {error ? (
            <div className="rounded-lg border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          {detail ? (
            <Card padded={false}>
              <div className="border-b border-[var(--line2)] p-[18px]">
                <CardHead
                  title={`${detail.total.toLocaleString()} pole${detail.total === 1 ? "" : "s"} on this survey`}
                  hint={
                    <span className="flex flex-wrap items-center gap-2">
                      <Chip tone={lifecycleTone(detail.visit.lifecycleStatus)}>
                        {lifecycleLabel(detail.visit.lifecycleStatus)}
                      </Chip>
                      <span>
                        {detail.visit.surveyedCount.toLocaleString()} surveyed ·{" "}
                        {detail.visit.openDefects.toLocaleString()} open finding
                        {detail.visit.openDefects === 1 ? "" : "s"}
                        {detail.visit.completedAt
                          ? ` · completed ${formatClientDate(detail.visit.completedAt)}`
                          : ""}
                      </span>
                    </span>
                  }
                />
              </div>
              {detail.poles.length === 0 ? (
                <p className="px-[18px] py-10 text-center text-[13px] text-[var(--muted)]">
                  No poles have been recorded on this survey yet.
                </p>
              ) : (
                <div>
                  {detail.poles.map((pole) => (
                    <PoleRow
                      key={pole.id}
                      pole={pole}
                      onOpen={() => openPole(detail.poles, pole)}
                    />
                  ))}
                  {detail.total > detail.poles.length ? (
                    <p className="border-t border-[var(--line2)] px-[18px] py-3 text-[12px] text-[var(--muted)]">
                      Showing the first {detail.poles.length.toLocaleString()} of{" "}
                      {detail.total.toLocaleString()} poles.
                    </p>
                  ) : null}
                </div>
              )}
            </Card>
          ) : (
            <Card padded={false}>
              <div className="border-b border-[var(--line2)] p-[18px]">
                <FilterBar>
                  <SearchField
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search Pencawang"
                    aria-label="Search surveys by Pencawang"
                  />
                  <select
                    aria-label="Survey stage"
                    value={stage}
                    onChange={(event) =>
                      setStage(event.target.value as StageFilter)
                    }
                    className={filterSelectClass}
                  >
                    {STAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {mainheads.length > 1 ? (
                    <select
                      aria-label="Mainhead"
                      value={mainheadId}
                      onChange={(event) => {
                        setMainheadId(event.target.value);
                        if (session?.token) {
                          void load(session.token, event.target.value);
                        }
                      }}
                      className={filterSelectClass}
                    >
                      <option value="">All Mainheads</option>
                      {mainheads.map((mainhead) => (
                        <option key={mainhead.id} value={mainhead.id}>
                          {mainhead.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </FilterBar>
              </div>

              {filtered.length === 0 ? (
                <p className="px-[18px] py-12 text-center text-[13px] text-[var(--muted)]">
                  {isLoading
                    ? "Loading surveys…"
                    : mainheads.length === 0
                      ? "No Mainheads have been assigned to your organization yet. Contact ASCURE to get access."
                      : "No surveys match these filters."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className={tableHeadClass}>
                      <tr>
                        <th className={tableHeadCellClass}>Pencawang</th>
                        <th className={tableHeadCellClass}>Stage</th>
                        <th className={tableHeadCellClass}>Poles surveyed</th>
                        <th className={tableHeadCellClass}>Findings</th>
                        <th className={tableHeadCellClass}>Started</th>
                        <th className={tableHeadCellClass}>Completed</th>
                        <th className={tableHeadCellClass} aria-label="Open" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((visit) => (
                        <tr
                          key={visit.id}
                          tabIndex={0}
                          onClick={() => void openVisit(visit)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void openVisit(visit);
                            }
                          }}
                          className={`${tableRowClass} cursor-pointer outline-none last:border-b-0 focus-visible:bg-[var(--panel-muted)]`}
                          aria-label={`Open the ${visit.pencawang} survey`}
                        >
                          <td className={tableCellClass}>
                            <span className="block font-semibold text-[var(--foreground)]">
                              {visit.pencawang}
                            </span>
                            <span className="block text-[11.5px] text-[var(--muted)]">
                              {visit.mainhead}
                            </span>
                          </td>
                          <td className={tableCellClass}>
                            <Chip tone={lifecycleTone(visit.lifecycleStatus)}>
                              {lifecycleLabel(visit.lifecycleStatus)}
                            </Chip>
                          </td>
                          <td className={tableMonoCellClass}>
                            {visit.surveyedCount.toLocaleString()} /{" "}
                            {visit.poleCount.toLocaleString()}
                          </td>
                          <td className={tableCellClass}>
                            {visit.openDefects === 0 ? (
                              <span className="text-[var(--muted)]">—</span>
                            ) : (
                              <span className="flex items-center gap-1.5">
                                <AlertTriangle
                                  size={13}
                                  className="text-[var(--high)]"
                                />
                                <span className="font-mono text-[12.5px] tabular-nums">
                                  {visit.openDefects.toLocaleString()}
                                </span>
                                {/* The urgent Siren is hidden until the
                                    emergency system's rollout completes
                                    (docs/tnb-view-emergency-hidden.md). */}
                              </span>
                            )}
                          </td>
                          <td className={tableMonoCellClass}>
                            {formatClientDate(visit.startedAt)}
                          </td>
                          <td className={tableMonoCellClass}>
                            {formatClientDate(visit.completedAt)}
                          </td>
                          <td className={tableCellClass}>
                            <ChevronRight
                              size={15}
                              className="text-[var(--muted-2)]"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="flex items-start gap-1.5 border-t border-[var(--line2)] px-[18px] py-3 text-[12px] text-[var(--muted)]">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    Showing {filtered.length.toLocaleString()} of{" "}
                    {visitTotal.toLocaleString()} surveys
                    {visitTotal > visits.length
                      ? ` (the ${visits.length.toLocaleString()} most recent are loaded)`
                      : ""}
                    .
                  </p>
                </div>
              )}
            </Card>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export function ClientVisitsClient() {
  return (
    <AuthGuard>
      <ClientVisitsContent />
    </AuthGuard>
  );
}
