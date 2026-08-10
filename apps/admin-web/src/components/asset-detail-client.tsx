"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  Map as MapIcon,
  MapPin,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldCheck,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  EvidenceImageGrid,
  buildEvidenceEntries,
} from "@/components/inspection-evidence-grid";
import { PoleRecordView } from "@/components/pole-record-view";
import { ApiError } from "@/lib/api";
import { readAssetNavContext } from "@/lib/asset-nav";
import { fetchAssetDetail } from "@/lib/assets";
import { focusAssetOnMap } from "@/lib/map-nav";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { downloadAssetReportPreview } from "@/lib/report-templates";
import { createAssetShareLink, buildShareUrl } from "@/lib/share";
import { editChecklistValue, requestReinspection } from "@/lib/site-visits";
import type { AssetDetail } from "@/types/assets";
import type { AuthSession } from "@/types/auth";
import type { ChecklistColumn } from "@/types/site-visits";

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
  // The client's read-only survey feed — distinct from /site-visits above.
  if (href.startsWith("/visits")) {
    return "Surveys";
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

/**
 * The canonical column key for a checklist label — mirrors the API's
 * `normalizeChecklistLabel` (common/checklist-columns.ts), which is the
 * documented contract: `PATCH /inspections/:id/checklist-result` resolves the
 * edited item with this exact normalization, so a key derived here round-trips
 * to exactly one template item.
 */
function checklistKeyForLabel(label: string): string {
  return label.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Inline editor for one Inspection Result row's recorded value — the same
 * behavior as the Linked-Assets table and the map panel: plain text until
 * clicked, then the editor the template calls for (dropdown when the item
 * defines options, else a typed input). Saving is per-row; the server coerces
 * by input type and re-evaluates the defect flag, so the caller reloads after
 * a save.
 */
function EditableRemarkCell({
  column,
  value,
  onSave,
}: {
  column: ChecklistColumn;
  value: string | null;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A refetch (or paging to another pole) must win over a stale draft.
  useEffect(() => {
    setDraft(value ?? "");
    setEditing(false);
    setError("");
  }, [value, column.key]);

  const templateOptions = column.options ?? [];

  // A recorded value NOT among the template's current options (template edited
  // after the survey) would leave the dropdown blank — and saving from there
  // would silently discard what the crew recorded. Keep it as an extra choice.
  const options = useMemo(() => {
    if (templateOptions.length === 0) {
      return templateOptions;
    }
    const current = value?.trim();
    if (!current || templateOptions.some((option) => option.value === current)) {
      return templateOptions;
    }
    return [...templateOptions, { value: current, label: `${current} (not in list)` }];
  }, [templateOptions, value]);

  const commit = useCallback(async () => {
    if (draft === (value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      setEditing(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save this value.",
      );
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={`Edit ${column.label}`}
        className="group/edit inline-flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-slate-600 outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <span className="min-w-0 break-words">{value?.trim() || "—"}</span>
        <Pencil
          size={12}
          className="shrink-0 text-slate-300 transition group-hover/edit:text-[var(--brand)]"
        />
      </button>
    );
  }

  return (
    <div className="min-w-[11rem]">
      <div className="flex items-center gap-1.5">
        {options.length > 0 ? (
          <select
            autoFocus
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-[var(--brand)] bg-white px-2 py-1 text-sm text-slate-900"
          >
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            autoFocus
            value={draft}
            disabled={saving}
            inputMode={column.inputType === "NUMBER" ? "decimal" : "text"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commit();
              } else if (event.key === "Escape") {
                setEditing(false);
                setDraft(value ?? "");
                setError("");
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-[var(--brand)] bg-white px-2 py-1 text-sm text-slate-900"
          />
        )}
        <button
          type="button"
          onClick={() => void commit()}
          disabled={saving}
          aria-label="Save"
          className="rounded-md bg-[var(--brand)] p-1.5 text-[var(--on-brand)] disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw size={13} className="animate-spin" />
          ) : (
            <Check size={13} />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft(value ?? "");
            setError("");
          }}
          disabled={saving}
          aria-label="Cancel"
          className="rounded-md border border-slate-300 p-1.5 text-slate-500 disabled:opacity-50"
        >
          <X size={13} />
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
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
  // "Need Amendment" — send this pole back for re-inspection with a required
  // reason, mirroring the map side panel's send-back flow.
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [sendBackError, setSendBackError] = useState("");
  // The header is sticky, so "Need Amendment" can be pressed from anywhere in
  // the page — bring the reason form (rendered at the top) into view.
  const sendBackFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sendBackOpen) {
      sendBackFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [sendBackOpen]);

  // Public share link: mint → show the URL with Copy / WhatsApp actions.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareDays, setShareDays] = useState(30);
  const [shareUrl, setShareUrl] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const shareFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shareOpen) {
      shareFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [shareOpen]);
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
  // A CLIENT viewer (TNB) reads this page as the network OWNER, not as an
  // operator: they get the same presentation as a public share link
  // (PoleRecordView) instead of the crew's working surface. ADMIN keeps the
  // internal view so the team can still work while previewing the client's.
  const isClientViewer =
    session?.user?.isClientViewer === true && session?.user?.role !== "ADMIN";
  const canReport =
    (session?.user?.canReport === true || session?.user?.role === "ADMIN") &&
    // ⏸ HIDDEN FOR CLIENTS pending the final report design (owner, 2026-08-10).
    // Drop this clause to give TNB the per-asset report back.
    !isClientViewer;
  // Who may send a pole back: ADMIN, DC (canGovernQa), or the managing MANAGER
  // (canReviewSurvey) — same gate as the map panel; the API re-enforces scope.
  const canSendBack =
    session?.user?.role === "ADMIN" ||
    session?.user?.canGovernQa === true ||
    session?.user?.canReviewSurvey === true;
  // A client (TNB) may share a pole on their OWN network — the record the link
  // opens is the same one they are already looking at. The API confines them to
  // their assigned Mainheads and caps the link at 30 days.
  const canShare = canSendBack || isClientViewer;

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

  const handleSendBack = useCallback(async () => {
    const inspectionId = asset?.latestInspection?.id;
    if (!session?.token || !inspectionId) {
      return;
    }
    setSendingBack(true);
    setSendBackError("");
    try {
      await requestReinspection(session.token, inspectionId, sendBackReason.trim());
      setSendBackOpen(false);
      setSendBackReason("");
      // The pole now reads "not inspected" for the crew — reload so the banner
      // and inspection status reflect it.
      await loadAsset(session.token);
    } catch (sendError) {
      if (sendError instanceof ApiError && sendError.status === 401) {
        handleLogout();
        return;
      }
      setSendBackError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send this pole back.",
      );
    } finally {
      setSendingBack(false);
    }
  }, [session?.token, asset?.latestInspection?.id, sendBackReason, loadAsset, handleLogout]);

  const handleCreateShareLink = useCallback(async () => {
    if (!session?.token) {
      return;
    }
    setSharing(true);
    setShareError("");
    try {
      const link = await createAssetShareLink(session.token, assetId, shareDays);
      setShareUrl(buildShareUrl(link.token));
      setShareExpiresAt(link.expiresAt);
      setShareCopied(false);
    } catch (shareLinkError) {
      if (shareLinkError instanceof ApiError && shareLinkError.status === 401) {
        handleLogout();
        return;
      }
      setShareError(
        shareLinkError instanceof Error
          ? shareLinkError.message
          : "Unable to create the share link.",
      );
    } finally {
      setSharing(false);
    }
  }, [session?.token, assetId, shareDays, handleLogout]);

  const handleCopyShareUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
    } catch {
      // Clipboard can be unavailable (http, permissions) — the URL stays
      // visible in the box for a manual copy.
    }
  }, [shareUrl]);

  const reinspectionPending = Boolean(asset?.latestInspection?.reinspectionReason);

  // Inline checklist editing on the Inspection Result table — same behavior
  // (and same endpoint) as the Linked-Assets table and the map panel. Gate
  // mirrors them too: ADMIN / DC / the managing manager, re-enforced by the
  // API on every write.
  const checklistColumnsByKey = useMemo(() => {
    const map = new Map<string, ChecklistColumn>();
    for (const column of asset?.latestInspection?.checklist?.columns ?? []) {
      map.set(column.key, column);
    }
    return map;
  }, [asset?.latestInspection?.checklist]);

  const saveChecklistValue = useCallback(
    async (columnKey: string, next: string) => {
      const inspection = asset?.latestInspection;
      if (!session?.token || !inspection?.id) {
        throw new Error("Your session has expired — refresh and sign in again.");
      }
      await editChecklistValue(
        session.token,
        inspection.id,
        columnKey,
        next,
        inspection.siteVisitId ?? "",
      );
      // The server coerces by input type and re-evaluates the defect flag —
      // reload so Result / Severity / the red row highlight stay truthful.
      await loadAsset(session.token);
    },
    [session?.token, asset?.latestInspection, loadAsset],
  );

  // "Show on Map" needs coordinates to land on and a Pencawang to drill into.
  const canShowOnMap =
    asset?.latitude != null && asset?.longitude != null && Boolean(asset?.substationId);

  const handleShowOnMap = useCallback(() => {
    if (!asset?.substationId) {
      return;
    }
    focusAssetOnMap({
      assetId,
      pencawangId: asset.substationId,
      pencawangName: asset.pencawangName || "Pencawang",
    });
    router.push("/map");
  }, [asset?.substationId, asset?.pencawangName, assetId, router]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          {/* Frozen while scrolling, so the stepper + review actions stay in
              reach on long checklists. top-16 clears the app shell's sticky
              topbar on desktop; on smaller screens that bar is hidden. */}
          <div className="sticky top-0 z-20 flex flex-col gap-4 border-b border-[var(--line)] bg-[var(--background)] pb-4 pt-2 md:flex-row md:items-end md:justify-between lg:top-16">
            <div>
              <button
                type="button"
                onClick={() => router.push(backHref)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
              >
                <ArrowLeft size={16} />
                {backLabel(backHref)}
              </button>
              {/* A client viewer gets the pole's own heading + chips from
                  PoleRecordView below, so this operator-facing header would
                  only repeat it (and expose internal review state). */}
              {isClientViewer ? null : (
                <>
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
                    {reinspectionPending ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-[var(--shadow-soft)]">
                        <RotateCcw size={13} />
                        Sent back for re-inspection
                      </span>
                    ) : null}
                  </div>
                </>
              )}
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
              {canShare && asset ? (
                <button
                  type="button"
                  onClick={() => {
                    setShareError("");
                    setShareOpen((value) => !value);
                  }}
                  aria-expanded={shareOpen}
                  title="Create a public read-only link to this pole for someone without an ASCURE account"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  <Share2 size={16} />
                  Share
                </button>
              ) : null}
              {canShowOnMap ? (
                <button
                  type="button"
                  onClick={handleShowOnMap}
                  title="Open the Asset Map centred on this pole"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  <MapIcon size={16} />
                  Show on Map
                </button>
              ) : null}
              {canSendBack && asset?.latestInspection && !reinspectionPending ? (
                <button
                  type="button"
                  onClick={() => {
                    setSendBackError("");
                    setSendBackOpen((value) => !value);
                  }}
                  disabled={sendingBack}
                  aria-expanded={sendBackOpen}
                  title="Send this pole back for re-inspection, keeping the recorded data"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-800 shadow-[var(--shadow-soft)] transition hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw size={16} />
                  Need Amendment
                </button>
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

          {/* Share panel: mint a tokenized public link to THIS pole for someone
              without an account. The page it opens is read-only and live. */}
          {shareOpen ? (
            <div
              ref={shareFormRef}
              className="mt-4 scroll-mt-56 rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)] lg:scroll-mt-72"
            >
              <p className="text-sm font-semibold text-slate-900">
                Share this pole
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Anyone with the link can view this pole&apos;s current condition
                — details, inspection results, and photos. Read-only, no account
                needed. The link stops working when it expires.
              </p>
              {shareUrl ? (
                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      value={shareUrl}
                      onFocus={(event) => event.currentTarget.select()}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCopyShareUrl()}
                      className="rounded-md bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-[var(--on-brand)]"
                    >
                      {shareCopied ? "Copied!" : "Copy link"}
                    </button>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(
                        `Pole ${asset?.assetCode ?? ""} — current condition:\n${shareUrl}`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                    >
                      WhatsApp
                    </a>
                  </div>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Valid until {formatDate(shareExpiresAt)}.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setShareUrl("");
                        setShareExpiresAt("");
                      }}
                      className="font-semibold text-[var(--brand)] hover:underline"
                    >
                      Create another
                    </button>
                  </p>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    Link expires in
                    <select
                      value={shareDays}
                      disabled={sharing}
                      onChange={(event) => setShareDays(Number(event.target.value))}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value={7}>7 days</option>
                      <option value={30}>30 days</option>
                      {/* The API caps a client's link at 30 days — don't offer
                          a length it would silently shorten. */}
                      {isClientViewer ? null : (
                        <option value={90}>90 days</option>
                      )}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleCreateShareLink()}
                    disabled={sharing || !session?.token}
                    className="inline-flex items-center gap-2 rounded-md bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-[var(--on-brand)] transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sharing ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Share2 size={14} />
                    )}
                    Create link
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareOpen(false)}
                    disabled={sharing}
                    className="text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {shareError ? (
                <p className="mt-2 text-sm text-red-700">{shareError}</p>
              ) : null}
            </div>
          ) : null}

          {/* Reason form for "Need Amendment" — the reason is required and is
              what the crew sees; answers and photos are kept. */}
          {sendBackOpen && asset?.latestInspection && !reinspectionPending ? (
            <div
              ref={sendBackFormRef}
              // Clear the sticky header (+ the shell topbar on lg) when
              // scrolled into view.
              className="mt-4 scroll-mt-56 rounded-xl border border-amber-200 bg-amber-50 p-4 lg:scroll-mt-72"
            >
              <label
                htmlFor="send-back-reason"
                className="block text-sm font-semibold text-amber-900"
              >
                Why does this pole need re-inspecting?
              </label>
              <p className="mt-1 text-xs text-amber-800">
                The crew sees this. The recorded answers and photos are kept —
                the pole simply reads as not inspected until they redo it.
              </p>
              <textarea
                id="send-back-reason"
                autoFocus
                rows={3}
                value={sendBackReason}
                disabled={sendingBack}
                onChange={(event) => setSendBackReason(event.target.value)}
                placeholder="e.g. Kelegaan reading 5.98 m does not match the photo — please re-measure"
                className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
              />
              {sendBackError ? (
                <p className="mt-2 text-sm text-red-700">{sendBackError}</p>
              ) : null}
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleSendBack()}
                  disabled={sendingBack || sendBackReason.trim().length === 0}
                  className="inline-flex items-center gap-2 rounded-md bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-[var(--on-brand)] transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingBack ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                  Send back for re-inspection
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSendBackOpen(false);
                    setSendBackReason("");
                    setSendBackError("");
                  }}
                  disabled={sendingBack}
                  className="text-sm font-semibold text-amber-800 transition hover:text-amber-900"
                >
                  Cancel
                </button>
              </div>
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
            ) : asset && isClientViewer ? (
              /* The network owner's read: the SAME record a public share link
                 shows (PoleRecordView), so what TNB sees on the console and what
                 they get sent by WhatsApp are one presentation. No operator
                 fields, no review state, no inline editing. */
              <div className="mx-auto max-w-3xl">
                <PoleRecordView
                  assetCode={asset.assetCode}
                  assetType={asset.assetType}
                  latitude={asset.latitude}
                  longitude={asset.longitude}
                  facts={[
                    { label: "Pencawang", value: asset.pencawangName },
                    { label: "Location", value: asset.location },
                    { label: "Feeder", value: asset.feeder },
                    { label: "Name", value: asset.name },
                    {
                      label: "Kod Tiang",
                      value:
                        asset.savtRoutes.length > 0
                          ? asset.savtRoutes
                              .map((route) => route.poleCode)
                              .join(" · ")
                          : null,
                    },
                  ]}
                  inspection={
                    asset.latestInspection
                      ? {
                          submittedAt: asset.latestInspection.submittedAt,
                          totalDefects: inspectionDefectCount,
                          items: inspectionItems,
                          images: asset.latestInspection.images ?? [],
                        }
                      : null
                  }
                  emptyText="This pole has been registered but not surveyed yet."
                />
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
                  {/* Sent back for re-inspection — the crew sees this pole as
                      not-inspected until they re-submit it. */}
                  {asset.latestInspection?.reinspectionReason ? (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.05em] text-amber-800">
                        Sent back for re-inspection
                      </p>
                      <p className="mt-1 text-sm text-amber-900">
                        {asset.latestInspection.reinspectionReason}
                      </p>
                      {asset.latestInspection.reinspectionRequestedAt ? (
                        <p className="mt-1 text-xs text-amber-800 opacity-80">
                          {formatDate(asset.latestInspection.reinspectionRequestedAt)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
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
                            {displayedInspectionItems.map((item) => {
                              // The row is editable when its label resolves to a
                              // checklist column (IMAGE columns hold photos, not
                              // values — those stay read-only here).
                              const editColumn = canSendBack
                                ? checklistColumnsByKey.get(
                                    checklistKeyForLabel(item.label),
                                  )
                                : undefined;
                              const editable =
                                editColumn && editColumn.inputType !== "IMAGE";

                              return (
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
                                  {editable && editColumn ? (
                                    <EditableRemarkCell
                                      column={editColumn}
                                      value={item.remark}
                                      onSave={(next) =>
                                        saveChecklistValue(editColumn.key, next)
                                      }
                                    />
                                  ) : (
                                    item.remark || "—"
                                  )}
                                </td>
                              </tr>
                              );
                            })}
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
