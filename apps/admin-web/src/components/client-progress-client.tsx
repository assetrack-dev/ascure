"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Info,
  MapPin,
  RefreshCw,
  Siren,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardHead, Eyebrow, KpiCard, Tbtn } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  fetchClientMainheads,
  fetchClientPoles,
  fetchClientProgress,
  fetchClientSurveys,
  type ClientPoleList,
  type ClientProgress,
  type ClientSurvey,
  type ProgressGroup,
} from "@/lib/client-progress";
import type { AuthSession } from "@/types/auth";

/**
 * The network owner's (TNB) progress view: how much of their network has been
 * surveyed, what was found, and — for surveys the crew has finished — the poles
 * behind those numbers.
 *
 * ⚠ `total` counts poles ASCURE has REGISTERED in the client's Mainheads, not
 * every pole they own (the full asset register isn't imported). The page says so
 * explicitly rather than implying whole-network coverage.
 */

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

/** Survey lifecycle → a label a client can read without knowing our workflow. */
function lifecycleLabel(status: string | null): string {
  switch (status) {
    case "RONDAAN_SELESAI":
      return "Survey complete";
    case "DISAHKAN_PENGURUS":
      return "Verified";
    case "PERLU_PINDAAN":
      return "Under revision";
    case "PINDAAN_SELESAI":
      return "Revised";
    case "LAPORAN_SELESAI":
      return "Reported";
    case "ARKIB":
      return "Archived";
    default:
      return "In progress";
  }
}

/** Maintenance category → the words TNB uses, not our enum token. */
function formatCategory(category: string): string {
  switch (category.toUpperCase()) {
    case "RENTIS":
      return "Rentis";
    case "CAT_TIANG":
      return "Cat Tiang";
    case "SELENGGARAAN":
      return "Selenggaraan";
    default:
      return category;
  }
}

function severityTone(severity: string | null): string {
  switch (severity?.toUpperCase()) {
    case "CRITICAL":
      return "border-[var(--critical-border)] bg-[var(--critical-bg)] text-[var(--critical-text)]";
    case "HIGH":
      return "border-[var(--high-border)] bg-[var(--high-bg)] text-[var(--high-text)]";
    case "MEDIUM":
      return "border-[var(--medium-border)] bg-[var(--medium-bg)] text-[var(--medium-text)]";
    default:
      return "border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]";
  }
}

/** Coverage bar — inspected vs registered, with the count spelled out. */
function CoverageRow({
  group,
  onOpen,
  actionLabel,
}: {
  group: ProgressGroup;
  onOpen: () => void;
  actionLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={actionLabel}
      className="group w-full border-b border-[var(--line2)] px-4 py-3 text-left transition last:border-b-0 hover:bg-[var(--panel-muted)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--foreground)]">
          {group.name}
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--muted)]">
          {group.inspected.toLocaleString()} / {group.total.toLocaleString()}
        </span>
        <span className="w-11 shrink-0 text-right font-mono text-[13px] font-bold tabular-nums text-[var(--foreground)]">
          {group.percent}%
        </span>
        <ChevronRight
          size={15}
          className="shrink-0 text-[var(--muted-2)] transition group-hover:text-[var(--brand)]"
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--panel-muted)]">
          <div
            className="h-full rounded-full bg-[var(--brand)]"
            style={{ width: `${group.percent}%` }}
          />
        </div>
        {group.openDefects > 0 ? (
          <span className="shrink-0 text-[11px] text-[var(--muted)]">
            {group.openDefects} defect{group.openDefects === 1 ? "" : "s"}
            {group.emergency > 0 ? ` · ${group.emergency} urgent` : ""}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function ClientProgressContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [progress, setProgress] = useState<ClientProgress | null>(null);
  const [surveys, setSurveys] = useState<ClientSurvey[]>([]);
  const [mainheads, setMainheads] = useState<{ id: string; name: string }[]>([]);
  const [poles, setPoles] = useState<ClientPoleList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // Where the user has drilled to: null = all Mainheads, then one Mainhead,
  // then one Pencawang's poles.
  const [mainheadId, setMainheadId] = useState<string | null>(null);
  const [mainheadName, setMainheadName] = useState<string>("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const load = useCallback(
    async (token: string, targetMainheadId: string | null) => {
      setIsLoading(true);
      setError("");
      try {
        const [nextProgress, nextSurveys, nextMainheads] = await Promise.all([
          fetchClientProgress(token, targetMainheadId ?? undefined),
          fetchClientSurveys(token),
          fetchClientMainheads(token),
        ]);

        // Most clients are in charge of ONE Mainhead. Listing it as a single row
        // and asking them to click through is a wasted level (and leaves the
        // coverage card mostly blank), so drop straight to its Pencawang and
        // treat that Mainhead as the root — `singleMainhead` then hides the
        // now-meaningless "All Mainheads" crumb.
        if (
          targetMainheadId === null &&
          nextProgress.level === "mainhead" &&
          nextProgress.groups.length === 1
        ) {
          const only = nextProgress.groups[0];
          setMainheadId(only.id);
          setMainheadName(only.name);
          setSurveys(nextSurveys);
          setMainheads(nextMainheads);
          setProgress(await fetchClientProgress(token, only.id));
          return;
        }

        setProgress(nextProgress);
        setSurveys(nextSurveys);
        setMainheads(nextMainheads);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load progress.",
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
      void load(stored.token, null);
    } else {
      setIsLoading(false);
    }
  }, [load]);

  const openMainhead = useCallback(
    (group: ProgressGroup) => {
      setMainheadId(group.id);
      setMainheadName(group.name);
      setPoles(null);
      if (session?.token) void load(session.token, group.id);
    },
    [session?.token, load],
  );

  const openPencawang = useCallback(
    async (group: ProgressGroup) => {
      if (!session?.token) return;
      setIsLoading(true);
      setError("");
      try {
        setPoles(await fetchClientPoles(session.token, group.id));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load these poles.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [session?.token, handleLogout],
  );

  const goToTop = useCallback(() => {
    setMainheadId(null);
    setMainheadName("");
    setPoles(null);
    if (session?.token) void load(session.token, null);
  }, [session?.token, load]);

  const goToMainhead = useCallback(() => {
    setPoles(null);
  }, []);

  // With one assigned Mainhead there is no level above it to return to.
  const singleMainhead = mainheads.length === 1;

  const severityTotal = useMemo(
    () => progress?.defects.bySeverity.reduce((sum, row) => sum + row.value, 0) ?? 0,
    [progress],
  );

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-4">
          {/* Header + breadcrumb */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>Survey Progress</Eyebrow>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px]">
                {singleMainhead ? null : (
                  <button
                    type="button"
                    onClick={goToTop}
                    className={
                      mainheadId
                        ? "font-semibold text-[var(--brand)] hover:underline"
                        : "font-semibold text-[var(--foreground)]"
                    }
                  >
                    All Mainheads
                  </button>
                )}
                {mainheadId ? (
                  <>
                    {singleMainhead ? null : (
                      <ChevronRight size={13} className="text-[var(--muted-2)]" />
                    )}
                    <button
                      type="button"
                      onClick={goToMainhead}
                      className={
                        poles
                          ? "font-semibold text-[var(--brand)] hover:underline"
                          : "font-semibold text-[var(--foreground)]"
                      }
                    >
                      {mainheadName}
                    </button>
                  </>
                ) : null}
                {poles ? (
                  <>
                    <ChevronRight size={13} className="text-[var(--muted-2)]" />
                    <span className="font-semibold text-[var(--foreground)]">
                      {poles.substation.name}
                    </span>
                  </>
                ) : null}
              </div>
              <h1 className="mt-1 text-2xl font-bold text-[var(--foreground)]">
                {session?.user?.organizationName ?? "Network"} survey progress
              </h1>
            </div>
            <Tbtn
              onClick={() =>
                session?.token ? load(session.token, mainheadId) : undefined
              }
              disabled={isLoading || !session?.token}
            >
              <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </Tbtn>
          </div>

          {error ? (
            <div className="rounded-lg border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          {progress ? (
            <>
              {/* Headline coverage */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Poles surveyed"
                  value={progress.inspected}
                  icon={ClipboardCheck}
                  tone="info"
                  context={`of ${progress.total.toLocaleString()} registered · ${progress.percent}%`}
                />
                <KpiCard
                  label="Coverage"
                  value={`${progress.percent}%`}
                  icon={MapPin}
                  tone={progress.percent >= 100 ? "success" : "neutral"}
                  context={
                    progress.lastInspectionAt
                      ? `last survey ${formatDate(progress.lastInspectionAt)}`
                      : "no surveys yet"
                  }
                />
                <KpiCard
                  label="Open findings"
                  value={progress.defects.open}
                  icon={AlertTriangle}
                  tone={progress.defects.open > 0 ? "high" : "success"}
                  context="defects awaiting action"
                />
                <KpiCard
                  label="Urgent"
                  value={progress.defects.emergency}
                  icon={Siren}
                  alarm={progress.defects.emergency > 0}
                  context="flagged as emergency"
                />
              </div>

              {/* The honest denominator — say what "registered" means. */}
              <p className="flex items-start gap-1.5 text-[12px] text-[var(--muted)]">
                <Info size={13} className="mt-0.5 shrink-0" />
                Coverage is measured against poles recorded in ASCURE for your
                Mainheads. Poles not yet registered by a survey are not counted.
              </p>

              {poles ? (
                /* Pole evidence — completed surveys only */
                <Card>
                  <CardHead
                    title={`${poles.substation.name} — ${poles.poles.length} pole${poles.poles.length === 1 ? "" : "s"}`}
                    hint="Surveys the crew has completed"
                    actions={
                      <Tbtn onClick={goToMainhead}>
                        <ChevronLeft size={14} />
                        Back
                      </Tbtn>
                    }
                  />
                  {poles.poles.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[13px] text-[var(--muted)]">
                      No completed surveys here yet. Poles appear once the crew
                      has finished and submitted the survey.
                    </p>
                  ) : (
                    <div>
                      {poles.poles.map((pole) => (
                        <button
                          key={pole.id}
                          type="button"
                          onClick={() =>
                            router.push(
                              `/assets/${encodeURIComponent(pole.id)}?from=${encodeURIComponent("/progress")}`,
                            )
                          }
                          className="flex w-full items-center gap-3 border-b border-[var(--line2)] px-4 py-3 text-left transition last:border-b-0 hover:bg-[var(--panel-muted)]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[13px] font-semibold text-[var(--foreground)]">
                              {pole.assetCode}
                            </span>
                            <span className="block text-[11.5px] text-[var(--muted)]">
                              {formatDate(pole.inspectedAt)} ·{" "}
                              {lifecycleLabel(pole.lifecycleStatus)} ·{" "}
                              {pole.photoCount} photo
                              {pole.photoCount === 1 ? "" : "s"}
                            </span>
                          </span>
                          {pole.defects.length > 0 ? (
                            <span className="flex shrink-0 flex-wrap justify-end gap-1">
                              {pole.defects.slice(0, 2).map((defect) => (
                                <span
                                  key={defect.id}
                                  className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${severityTone(defect.severity)}`}
                                >
                                  {defect.severity ?? "DEFECT"}
                                </span>
                              ))}
                              {pole.defects.length > 2 ? (
                                <span className="rounded-full border border-[var(--line)] bg-[var(--panel-muted)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--muted)]">
                                  +{pole.defects.length - 2}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="shrink-0 text-[11.5px] text-[var(--success-text)]">
                              No defects
                            </span>
                          )}
                          <ChevronRight
                            size={15}
                            className="shrink-0 text-[var(--muted-2)]"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                  {/* Coverage breakdown */}
                  <div className="lg:col-span-2">
                    <Card>
                      <CardHead
                        title={
                          progress.level === "mainhead"
                            ? "Coverage by Mainhead"
                            : `Coverage by Pencawang — ${mainheadName}`
                        }
                        hint={
                          progress.level === "mainhead"
                            ? "Select a Mainhead to drill in"
                            : "Select a Pencawang to see its poles"
                        }
                      />
                      {progress.groups.length === 0 ? (
                        <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
                          {mainheads.length === 0
                            ? "No Mainheads have been assigned to your organization yet. Contact ASCURE to get access."
                            : "Nothing recorded here yet."}
                        </p>
                      ) : (
                        <div>
                          {progress.groups.map((group) => (
                            <CoverageRow
                              key={group.id}
                              group={group}
                              actionLabel={
                                progress.level === "mainhead"
                                  ? "See this Mainhead's Pencawang"
                                  : "See this Pencawang's poles"
                              }
                              onOpen={() =>
                                progress.level === "mainhead"
                                  ? openMainhead(group)
                                  : void openPencawang(group)
                              }
                            />
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>

                  {/* Findings + recent surveys */}
                  <div className="space-y-4">
                    <Card>
                      <CardHead
                        title="Findings"
                        hint={`${progress.defects.open} open`}
                      />
                      <div className="space-y-3 px-4 pb-4">
                        {severityTotal === 0 ? (
                          <p className="py-4 text-center text-[13px] text-[var(--muted)]">
                            No open defects.
                          </p>
                        ) : (
                          progress.defects.bySeverity.map((row) => (
                            <div key={row.label}>
                              <div className="mb-1 flex justify-between text-[12px]">
                                <span className="font-medium text-[var(--foreground-soft)]">
                                  {row.label.charAt(0) +
                                    row.label.slice(1).toLowerCase()}
                                </span>
                                <span className="font-semibold tabular-nums text-[var(--foreground)]">
                                  {row.value}
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-muted)]">
                                <div
                                  className="h-full rounded-full bg-[var(--brand)]"
                                  style={{
                                    width: `${Math.round((row.value / severityTotal) * 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </Card>

                    {progress.defects.byCategory.length > 0 ? (
                      <Card>
                        <CardHead
                          title="Work type"
                          hint="Open defects by category"
                        />
                        <div className="space-y-2.5 px-4 pb-4">
                          {progress.defects.byCategory.map((row) => (
                            <div
                              key={row.label}
                              className="flex items-center justify-between gap-3 text-[12.5px]"
                            >
                              <span className="min-w-0 truncate text-[var(--foreground-soft)]">
                                {formatCategory(row.label)}
                              </span>
                              <span className="shrink-0 font-semibold tabular-nums text-[var(--foreground)]">
                                {row.value.toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    ) : null}

                    <Card>
                      <CardHead title="Recent surveys" hint="Completed work" />
                      {surveys.length === 0 ? (
                        <p className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">
                          No completed surveys yet.
                        </p>
                      ) : (
                        <div>
                          {surveys.slice(0, 8).map((survey) => (
                            <div
                              key={survey.id}
                              className="border-b border-[var(--line2)] px-4 py-2.5 last:border-b-0"
                            >
                              <p className="truncate text-[12.5px] font-semibold text-[var(--foreground)]">
                                {survey.pencawang}
                              </p>
                              <p className="text-[11px] text-[var(--muted)]">
                                {survey.poleCount} pole
                                {survey.poleCount === 1 ? "" : "s"} ·{" "}
                                {lifecycleLabel(survey.lifecycleStatus)} ·{" "}
                                {formatDate(survey.completedAt)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
              )}
            </>
          ) : isLoading ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-24 animate-pulse rounded-xl bg-[var(--panel-muted)]"
                  />
                ))}
              </div>
              <div className="h-64 animate-pulse rounded-xl bg-[var(--panel-muted)]" />
            </div>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}

export function ClientProgressClient() {
  return (
    <AuthGuard>
      <ClientProgressContent />
    </AuthGuard>
  );
}
