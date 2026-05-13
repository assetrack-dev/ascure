"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Radio,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchSiteVisitDetail } from "@/lib/site-visits";
import type { AuthSession } from "@/types/auth";
import type {
  OperationalHealthStatus,
  SiteVisitAssetLink,
  SiteVisitDetail,
  SiteVisitStatus,
  SiteVisitValidationStatus,
} from "@/types/site-visits";

const AUTO_REFRESH_MS = 60000;
const fieldClassName =
  "rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]";

function formatEnum(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(date: string | null | undefined) {
  if (!date) {
    return "Not recorded";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function formatNullable(value: string | null | undefined) {
  return value?.trim() || "Not recorded";
}

function displayPencawang(visit: SiteVisitDetail) {
  return (
    [visit.pencawangCode, visit.pencawangName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" - ") || "Site Visit"
  );
}

function displayTeam(visit: SiteVisitDetail) {
  return visit.team?.name?.trim() || visit.team?.code?.trim() || "Unassigned";
}

function HealthBadge({ status }: { status: OperationalHealthStatus }) {
  const className =
    status === "CRITICAL"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "WARNING"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${className}`}>
      {status}
    </span>
  );
}

function StatusBadge({ status }: { status: SiteVisitStatus }) {
  const className =
    status === "COMPLETED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "CANCELLED"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnum(status)}
    </span>
  );
}

function ValidationBadge({ status }: { status: SiteVisitValidationStatus }) {
  const className =
    status === "FAILED"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "WARNING"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : status === "VALIDATED"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnum(status)}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className={fieldClassName}>
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClassName =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${toneClassName}`}>
          <Icon size={17} />
        </div>
      </div>
    </div>
  );
}

function ProgressPanel({ visit }: { visit: SiteVisitDetail }) {
  const boundedPercentage = Math.min(Math.max(visit.completionPercentage, 0), 100);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Inspection Progress</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {visit.inspectedAssets} of {visit.totalAssets} linked assets submitted
          </p>
        </div>
        <div className="text-3xl font-bold text-slate-950">{boundedPercentage}%</div>
      </div>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[var(--brand)]"
          style={{ width: `${boundedPercentage}%` }}
        />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="Pending" value={visit.pendingAssets} icon={Clock3} />
        <MetricTile
          label="Defects"
          value={visit.defectsFound}
          icon={AlertTriangle}
          tone={visit.defectsFound > 0 ? "warning" : "neutral"}
        />
        <MetricTile label="Images" value={visit.images.length} icon={Radio} />
      </div>
    </section>
  );
}

function GisPanel({ visit }: { visit: SiteVisitDetail }) {
  const hasCoordinates =
    typeof visit.checkInLatitude === "number" && typeof visit.checkInLongitude === "number";

  return (
    <aside className="space-y-6">
      <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <MapPin size={17} className="text-[var(--brand)]" />
            GIS Operations
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            {hasCoordinates ? "Coordinate" : "Standby"}
          </span>
        </div>

        <div className="mt-5 h-56 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                "linear-gradient(rgba(20,184,166,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(20,184,166,0.2) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          >
            <div className="flex h-full items-center justify-center px-5 text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-teal-300/40 bg-teal-300/10 text-teal-100">
                  <MapPin size={20} />
                </div>
                <p className="mt-3 text-sm font-semibold text-teal-50">
                  {hasCoordinates
                    ? `${visit.checkInLatitude?.toFixed(5)}, ${visit.checkInLongitude?.toFixed(5)}`
                    : "No check-in coordinate"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <dl className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Accuracy</dt>
            <dd className="font-semibold text-slate-900">
              {visit.checkInAccuracyMeters === null
                ? "Not recorded"
                : `${visit.checkInAccuracyMeters} m`}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Captured</dt>
            <dd className="font-semibold text-slate-900">
              {formatDateTime(visit.checkInCapturedAt)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Feeder</dt>
            <dd className="font-semibold text-slate-900">{formatNullable(visit.feederId)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Route</dt>
            <dd className="font-semibold text-slate-900">{formatNullable(visit.feederRouteId)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Geometry</dt>
            <dd className="font-semibold text-slate-900">
              {formatNullable(visit.gisGeometryVersion)}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

function SiteVisitDetailContent({ siteVisitId }: { siteVisitId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [visit, setVisit] = useState<SiteVisitDetail | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadVisit = useCallback(
    async (token: string, showLoading = true) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError("");

      try {
        const nextVisit = await fetchSiteVisitDetail(token, siteVisitId);
        setVisit(nextVisit);
      } catch (visitError) {
        if (visitError instanceof ApiError && visitError.status === 401) {
          handleLogout();
          return;
        }

        setError(visitError instanceof Error ? visitError.message : "Unable to load site visit.");
        if (showLoading) {
          setVisit(null);
        }
      } finally {
        if (showLoading) {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [handleLogout, siteVisitId],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadVisit(storedSession.token);
    }
  }, [loadVisit]);

  useEffect(() => {
    if (!autoRefresh || !session?.token) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadVisit(session.token, false);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadVisit, session?.token]);

  const isReadOnly = session?.user?.role !== "ADMIN";
  const submittedInspections = useMemo(
    () => visit?.inspections.filter((inspection) => inspection.completionStatus === "SUBMITTED") ?? [],
    [visit],
  );
  const operationalAssetRows = useMemo(() => {
    if (!visit) {
      return [];
    }

    const assetsById = new Map<string, SiteVisitAssetLink>();

    visit.linkedAssets.forEach((link) => {
      assetsById.set(link.assetId, link);
    });

    visit.inspections.forEach((inspection) => {
      if (!inspection.assetId || assetsById.has(inspection.assetId)) {
        return;
      }

      assetsById.set(inspection.assetId, {
        id: `inspection-${inspection.assetId}`,
        assetId: inspection.assetId,
        addedAt: inspection.submittedAt ?? inspection.createdAt,
        source: "INSPECTION",
        notes: null,
        asset: {
          id: inspection.assetId,
          assetCode: inspection.assetCode,
          name: inspection.assetName,
        },
      });
    });

    return Array.from(assetsById.values()).sort((left, right) =>
      left.asset.assetCode.localeCompare(right.asset.assetCode, "en", {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [visit]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.push("/site-visits")}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
              >
                <ArrowLeft size={16} />
                Site Visits
              </button>
              <p className="mt-4 text-sm font-semibold uppercase text-[var(--brand)]">
                Operations Detail
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {visit ? displayPencawang(visit) : "Site Visit"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </span>
                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(event) => setAutoRefresh(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  Auto-refresh 60s
                </label>
                {visit ? <HealthBadge status={visit.operationalHealthStatus} /> : null}
                {visit ? <StatusBadge status={visit.status} /> : null}
                {visit ? <ValidationBadge status={visit.validationStatus} /> : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadVisit(session.token, false) : undefined)}
              disabled={(isLoading && !visit) || isRefreshing || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && !visit ? (
              <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="h-8 w-72 animate-pulse rounded-md bg-slate-100" />
                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              </div>
            ) : error && !visit ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : visit ? (
              <div className="space-y-6">
                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile
                    label="Completion"
                    value={`${visit.completionPercentage}%`}
                    icon={CheckCircle2}
                    tone="success"
                  />
                  <MetricTile label="Linked Assets" value={visit.totalAssets} icon={Activity} />
                  <MetricTile
                    label="Defects Found"
                    value={visit.defectsFound}
                    icon={AlertTriangle}
                    tone={visit.defectsFound > 0 ? "warning" : "neutral"}
                  />
                  <MetricTile
                    label="Last Activity"
                    value={formatDateTime(visit.lastActivityAt)}
                    icon={Clock3}
                  />
                </div>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-6">
                    <ProgressPanel visit={visit} />

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                        <Activity size={17} className="text-[var(--brand)]" />
                        Operational Metadata
                      </div>
                      <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField label="MAINHEAD" value={formatNullable(visit.mainhead)} />
                        <DetailField label="Pencawang Code" value={formatNullable(visit.pencawangCode)} />
                        <DetailField label="Pencawang Name" value={formatNullable(visit.pencawangName)} />
                        <DetailField label="Functional Location" value={formatNullable(visit.functionalLocation)} />
                        <DetailField label="Visit Type" value={formatEnum(visit.visitType)} />
                        <DetailField label="Cycle" value={visit.cycleNumber === null ? "Not recorded" : String(visit.cycleNumber)} />
                        <DetailField label="Team" value={displayTeam(visit)} />
                        <DetailField label="Created By" value={formatNullable(visit.createdBy?.name ?? visit.createdBy?.email)} />
                      </dl>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                          <Users size={17} className="text-[var(--brand)]" />
                          Team Members
                        </div>
                        <span className="text-sm text-[var(--muted)]">
                          {visit.teamMembers.length} active on visit
                        </span>
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {visit.teamMembers.length > 0 ? (
                          visit.teamMembers.map((member) => (
                            <div key={`${member.id}-${member.siteVisitUserId ?? ""}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                              <p className="text-sm font-semibold text-slate-950">
                                {member.name || member.email || "Team member"}
                              </p>
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                {formatNullable(member.role)} / Joined {formatDateTime(member.joinedAt)}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)] md:col-span-2">
                            No team members returned for this visit.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                          <Activity size={17} className="text-[var(--brand)]" />
                          Linked Assets
                        </div>
                        <span className="text-sm text-[var(--muted)]">
                          {operationalAssetRows.length} rows
                        </span>
                      </div>
                      <div className="mt-5 overflow-x-auto">
                        {operationalAssetRows.length > 0 ? (
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-y border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                                <th className="px-4 py-3">Asset</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Source</th>
                                <th className="px-4 py-3">Added</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {operationalAssetRows.map((link) => (
                                <tr key={link.id}>
                                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-900">
                                    {link.asset.assetCode}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-700">
                                    {formatNullable(link.asset.assetType?.name ?? link.asset.assetType?.code)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {formatNullable(link.source)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {formatDateTime(link.addedAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
                            No linked assets returned for this visit.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                          <CalendarDays size={17} className="text-[var(--brand)]" />
                          Inspections
                        </div>
                        <span className="text-sm text-[var(--muted)]">
                          {submittedInspections.length}/{visit.inspections.length} submitted
                        </span>
                      </div>
                      <div className="mt-5 overflow-x-auto">
                        {visit.inspections.length > 0 ? (
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-y border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                                <th className="px-4 py-3">Asset</th>
                                <th className="px-4 py-3">Template</th>
                                <th className="px-4 py-3">Cycle</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Defects</th>
                                <th className="px-4 py-3">Images</th>
                                <th className="px-4 py-3">Submitted</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {visit.inspections.map((inspection) => (
                                <tr key={inspection.id}>
                                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-900">
                                    {inspection.assetCode}
                                  </td>
                                  <td className="min-w-56 px-4 py-4 text-slate-700">
                                    {formatNullable(inspection.templateName)}
                                    {inspection.templateVersion ? (
                                      <span className="ml-2 text-xs text-[var(--muted)]">
                                        v{inspection.templateVersion}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {inspection.cycleNumber ?? "N/A"}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {formatEnum(inspection.completionStatus)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-900">
                                    {inspection.defectCount}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {inspection.imageCount}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {formatDateTime(inspection.submittedAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
                            No inspections returned for this visit.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                        <Clock3 size={17} className="text-[var(--brand)]" />
                        Timestamps & Notes
                      </div>
                      <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField label="Started" value={formatDateTime(visit.startedAt)} />
                        <DetailField label="Completed" value={formatDateTime(visit.completedAt)} />
                        <DetailField label="Ended" value={formatDateTime(visit.endedAt)} />
                        <DetailField label="Validated" value={formatDateTime(visit.validatedAt)} />
                        <DetailField label="Validation Summary" value={formatNullable(visit.validationSummary)} />
                        <DetailField label="Completion Notes" value={formatNullable(visit.completionNotes)} />
                        <DetailField label="Visit Notes" value={formatNullable(visit.notes)} />
                        <DetailField label="Cancel Reason" value={formatNullable(visit.cancelReason)} />
                      </dl>
                    </section>
                  </div>

                  <GisPanel visit={visit} />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)] shadow-[var(--shadow-card)]">
                Site visit not found.
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function SiteVisitDetailClient({ siteVisitId }: { siteVisitId: string }) {
  return (
    <AuthGuard>
      <SiteVisitDetailContent siteVisitId={siteVisitId} />
    </AuthGuard>
  );
}
