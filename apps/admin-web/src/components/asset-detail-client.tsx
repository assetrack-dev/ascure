"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  MapPin,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  EvidenceImageGrid,
  buildEvidenceEntries,
} from "@/components/inspection-evidence-grid";
import { ApiError } from "@/lib/api";
import { readAssetNavContext } from "@/lib/asset-nav";
import { fetchAssetDetail } from "@/lib/assets";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { downloadAssetReportPreview } from "@/lib/report-templates";
import type { AssetDetail } from "@/types/assets";
import type { AuthSession } from "@/types/auth";

function formatDate(date: string | null) {
  if (!date) {
    return "No date";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsedDate);
}

function formatNullable(value: string | null) {
  return value?.trim() || "Not recorded";
}

function formatInspectionStatus(status: AssetDetail["inspectionStatus"]) {
  return status === "COMPLETED" ? "Completed" : "Pending";
}

/** Label for the back button, chosen from where the user arrived. */
function backLabel(href: string): string {
  if (href.startsWith("/site-visits")) {
    return "Operations Detail";
  }
  if (href.startsWith("/map")) {
    return "Map";
  }
  if (href.startsWith("/progress")) {
    return "Progress";
  }
  return "Assets";
}

function resultBadgeClassName(result: string | null | undefined) {
  const normalized = result?.toUpperCase();

  if (normalized === "PASS") {
    return "border-green-200 bg-green-50 text-green-700";
  }
  if (normalized === "FAIL") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function resultLabel(result: string | null | undefined) {
  const normalized = result?.toUpperCase();

  if (normalized === "NA" || normalized === "N/A") {
    return "N/A";
  }
  return normalized || "—";
}

/** A real pass/fail evaluation — i.e. a defect-check item. Informational items
 *  (readings, notes) record N/A here, which carries no meaning in this table. */
function isPassFailResult(result: string | null | undefined) {
  const normalized = result?.toUpperCase();
  return normalized === "PASS" || normalized === "FAIL";
}

function severityBadgeClassName(severity: string | null | undefined) {
  const normalized = severity?.toUpperCase();

  if (normalized === "CRITICAL") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (normalized === "HIGH") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (normalized === "MEDIUM") {
    return "border-yellow-200 bg-yellow-50 text-yellow-800";
  }
  if (normalized === "LOW") {
    return "border-green-200 bg-green-50 text-green-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]">
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-2 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function AssetDetailContent({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  // Where the back button returns to. Defaults to the Assets list, but a `?from=`
  // return path (e.g. set when opening an asset from a Site Visit) takes over so
  // the user goes back where they came from.
  const [backHref, setBackHref] = useState("/assets");
  // The raw ?from= value ("" when absent) — preserved on Prev/Next navigation
  // and used to match the sibling-list context stored by the entry point.
  const [fromParam, setFromParam] = useState("");
  // Ordered sibling asset ids stashed by the list the user came from; powers
  // the Prev/Next pole stepping. Null when opened without a list context
  // (deep link, marker popup) — the stepper simply doesn't render then.
  const [navIds, setNavIds] = useState<string[] | null>(null);
  // The Inspection Result table starts curated (only rows that carry meaning);
  // this reveals every checklist item, including informational readings that
  // recorded N/A with no remark.
  const [showAllInspectionItems, setShowAllInspectionItems] = useState(false);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadAsset = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const nextAsset = await fetchAssetDetail(token, assetId);
        setAsset(nextAsset);
      } catch (assetError) {
        if (assetError instanceof ApiError && assetError.status === 401) {
          handleLogout();
          return;
        }

        setError(assetError instanceof Error ? assetError.message : "Unable to load asset.");
      } finally {
        setIsLoading(false);
      }
    },
    [assetId, handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadAsset(storedSession.token);
    }
  }, [loadAsset]);

  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("from");
    // Only accept internal absolute paths (blocks protocol-relative "//" and
    // external URLs, so `from` can't be used as an open redirect).
    if (from && from.startsWith("/") && !from.startsWith("//")) {
      setBackHref(from);
      setFromParam(from);
    }

    setNavIds(readAssetNavContext(from ?? "")?.ids ?? null);
  }, []);

  const navIndex = navIds ? navIds.indexOf(assetId) : -1;

  const goToSibling = useCallback(
    (offset: number) => {
      if (!navIds || navIndex < 0) {
        return;
      }

      const targetId = navIds[navIndex + offset];

      if (!targetId) {
        return;
      }

      const query = fromParam ? `?from=${encodeURIComponent(fromParam)}` : "";
      router.push(`/assets/${encodeURIComponent(targetId)}${query}`);
    },
    [fromParam, navIds, navIndex, router],
  );

  // Arrow keys step between sibling poles, matching the map side panel.
  // Ignored while the focus is in a form control so text editing keeps its
  // native caret movement.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        goToSibling(-1);
      } else if (event.key === "ArrowRight") {
        goToSibling(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToSibling]);

  const isReadOnly = session?.user?.role !== "ADMIN";
  const canReport =
    session?.user?.canReport === true || session?.user?.role === "ADMIN";

  const inspectionImages = useMemo(
    () => buildEvidenceEntries(asset?.latestInspection?.images ?? []),
    [asset],
  );
  const inspectionItems = asset?.latestInspection?.items ?? [];
  // Shorten the table to the rows that carry meaning: a real pass/fail result
  // (defect checks), a flagged defect, or a written remark. Informational items
  // that just recorded N/A with no remark are hidden.
  const visibleInspectionItems = inspectionItems.filter(
    (item) =>
      item.isDefect ||
      isPassFailResult(item.result) ||
      (item.remark?.trim().length ?? 0) > 0,
  );
  // How many rows the curated view hides — the "See all" toggle only appears
  // when there is something extra to reveal.
  const hiddenInspectionItemCount =
    inspectionItems.length - visibleInspectionItems.length;
  const displayedInspectionItems = showAllInspectionItems
    ? inspectionItems
    : visibleInspectionItems;
  const inspectionDefectCount =
    asset?.latestInspection?.totalDefects ??
    inspectionItems.filter((item) => item.isDefect).length;

  const handlePreviewReport = useCallback(async () => {
    if (!session?.token || !asset) return;
    setPreviewing(true);
    setPreviewError("");
    try {
      await downloadAssetReportPreview(session.token, {
        id: assetId,
        assetCode: asset.assetCode,
      });
    } catch (reportError) {
      if (reportError instanceof ApiError && reportError.status === 401) {
        handleLogout();
        return;
      }
      setPreviewError(
        reportError instanceof Error
          ? reportError.message
          : "Unable to generate the report.",
      );
    } finally {
      setPreviewing(false);
    }
  }, [session?.token, asset, assetId, handleLogout]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.push(backHref)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
              >
                <ArrowLeft size={16} />
                {backLabel(backHref)}
              </button>
              <p className="mt-4 text-sm font-semibold uppercase text-[var(--brand)]">
                Asset Detail
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {asset?.assetCode ?? "Asset"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </span>
                {asset ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                    {formatInspectionStatus(asset.inspectionStatus)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {navIds && navIndex >= 0 && navIds.length > 1 ? (
                <div className="inline-flex h-10 items-stretch overflow-hidden rounded-md border border-slate-300 bg-white shadow-[var(--shadow-soft)]">
                  <button
                    type="button"
                    onClick={() => goToSibling(-1)}
                    disabled={navIndex <= 0}
                    title="Previous pole (←)"
                    aria-label="Previous pole"
                    className="inline-flex items-center gap-1 px-3 text-sm font-semibold text-slate-700 transition hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <ChevronLeft size={16} />
                    Prev
                  </button>
                  <span className="inline-flex items-center border-x border-slate-200 px-3 text-xs font-semibold tabular-nums text-slate-500">
                    {navIndex + 1} / {navIds.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToSibling(1)}
                    disabled={navIndex >= navIds.length - 1}
                    title="Next pole (→)"
                    aria-label="Next pole"
                    className="inline-flex items-center gap-1 px-3 text-sm font-semibold text-slate-700 transition hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    Next
                    <ChevronRight size={16} />
                  </button>
                </div>
              ) : null}
              {canReport ? (
                <button
                  type="button"
                  onClick={handlePreviewReport}
                  disabled={previewing || !asset || !session?.token}
                  title="Generate the per-asset visual report from the latest submitted inspection"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {previewing ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <FileText size={16} />
                  )}
                  Preview report
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => (session?.token ? loadAsset(session.token) : undefined)}
                disabled={isLoading || !session?.token}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>

          {previewError ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {previewError}
            </div>
          ) : null}

          <div className="mt-6">
            {isLoading && !asset ? (
              <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="h-8 w-56 animate-pulse rounded-md bg-slate-100" />
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : asset ? (
              <div className="space-y-6">
                <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <DetailField label="Asset Type" value={formatNullable(asset.assetType)} />
                  <DetailField label="Feeder" value={formatNullable(asset.feeder)} />
                  <DetailField label="Pencawang Name" value={formatNullable(asset.pencawangName)} />
                  <DetailField label="Date" value={formatDate(asset.date)} />
                  <DetailField label="Location" value={formatNullable(asset.location)} />
                  <DetailField label="Name" value={formatNullable(asset.name)} />
                  <DetailField
                    label="Latitude"
                    value={asset.latitude === null ? "Not recorded" : String(asset.latitude)}
                  />
                  <DetailField
                    label="Longitude"
                    value={asset.longitude === null ? "Not recorded" : String(asset.longitude)}
                  />
                </dl>

                <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--foreground)]">
                        Latest Inspection
                      </h2>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {asset.latestInspection?.remarks || "No inspection remarks recorded."}
                      </p>
                    </div>
                    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                      <CalendarDays size={14} />
                      {formatDate(asset.latestInspection?.submittedAt ?? asset.date)}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase text-[var(--muted)]">
                        Status
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {asset.latestInspection?.status ?? formatInspectionStatus(asset.inspectionStatus)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase text-[var(--muted)]">
                        Cycle
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {asset.latestInspection?.cycleNumber ?? "Not recorded"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase text-[var(--muted)]">
                        Images
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {asset.latestInspection?.images?.length ?? 0}
                      </div>
                    </div>
                  </div>
                </section>

                {asset.latestInspection ? (
                  <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 text-base font-semibold text-[var(--foreground)]">
                        <ClipboardList size={17} className="text-[var(--brand)]" />
                        Inspection Result
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-[var(--muted)]">
                          {displayedInspectionItems.length}{" "}
                          {displayedInspectionItems.length === 1 ? "item" : "items"}
                          {inspectionDefectCount > 0
                            ? ` · ${inspectionDefectCount} ${
                                inspectionDefectCount === 1 ? "defect" : "defects"
                              }`
                            : ""}
                        </span>
                        {hiddenInspectionItemCount > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setShowAllInspectionItems((value) => !value)
                            }
                            aria-pressed={showAllInspectionItems}
                            title={
                              showAllInspectionItems
                                ? "Show only pass/fail checks, defects, and items with a remark"
                                : `Show all ${inspectionItems.length} checklist items, including informational readings recorded as N/A`
                            }
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold shadow-[var(--shadow-soft)] transition ${
                              showAllInspectionItems
                                ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                                : "border-slate-200 bg-white text-slate-600 hover:border-[var(--brand)] hover:text-[var(--brand)]"
                            }`}
                          >
                            {showAllInspectionItems ? (
                              <EyeOff size={13} />
                            ) : (
                              <Eye size={13} />
                            )}
                            {showAllInspectionItems
                              ? "Show key items"
                              : `See all (${inspectionItems.length})`}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-5 overflow-x-auto">
                      {displayedInspectionItems.length > 0 ? (
                        <table className="min-w-full text-left text-sm">
                          <thead>
                            <tr className="border-y border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                              <th className="px-4 py-3">Checklist Item</th>
                              <th className="px-4 py-3">Result</th>
                              <th className="px-4 py-3">Severity</th>
                              <th className="px-4 py-3">Remark</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {displayedInspectionItems.map((item) => (
                              <tr
                                key={item.id}
                                className={item.isDefect ? "bg-red-50/40" : undefined}
                              >
                                <td className="px-4 py-3 font-medium text-slate-900">
                                  {item.label}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3">
                                  {isPassFailResult(item.result) ? (
                                    <span
                                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${resultBadgeClassName(item.result)}`}
                                    >
                                      {resultLabel(item.result)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3">
                                  {item.isDefect && item.severity ? (
                                    <span
                                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${severityBadgeClassName(item.severity)}`}
                                    >
                                      {item.severity}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {item.remark || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
                          No pass/fail results or remarks for this inspection.
                        </div>
                      )}
                    </div>
                  </section>
                ) : null}

                {asset.latestInspection ? (
                  <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 text-base font-semibold text-[var(--foreground)]">
                        <Camera size={17} className="text-[var(--brand)]" />
                        Inspection Photos
                      </div>
                      <span className="text-sm text-[var(--muted)]">
                        {inspectionImages.length} photos
                      </span>
                    </div>
                    <div className="mt-5">
                      <EvidenceImageGrid
                        entries={inspectionImages}
                        emptyText="No photos captured for this inspection."
                        titlePrefix="Inspection Image"
                      />
                    </div>
                  </section>
                ) : null}

                <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <MapPin size={17} className="text-[var(--brand)]" />
                    Location
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    {formatNullable(asset.location)}
                  </p>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function AssetDetailClient({ assetId }: { assetId: string }) {
  return (
    <AuthGuard>
      <AssetDetailContent assetId={assetId} />
    </AuthGuard>
  );
}
