"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  PackagePlus,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  assignSessionAsset,
  bulkAssignSessionAssets,
  fetchOperationalSessionDetail,
  getSessionAssets,
  removeSessionAsset,
  runOperationalSessionLifecycleAction,
  type OperationalSessionLifecycleAction,
} from "@/lib/operational-sessions";
import type { AuthSession } from "@/types/auth";
import type {
  BulkAssignSessionAssetsResult,
  OperationalSession,
  OperationalSessionAssignedAsset,
  OperationalSessionStatus,
} from "@/types/operational-sessions";

type DetailAction = {
  action: OperationalSessionLifecycleAction;
  label: string;
  tone: "primary" | "neutral" | "warning" | "danger" | "success";
  requiresComment?: boolean;
};

type AssetAssignmentModal = "add" | "bulk" | null;

type BulkAssignSummary = BulkAssignSessionAssetsResult["summary"];

const fieldClassName =
  "rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

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

function formatCoordinates(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null) {
    return "Not recorded";
  }

  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function parseBulkAssetIds(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((assetId) => assetId.trim())
        .filter(Boolean),
    ),
  );
}

function assetMutationErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return "You do not have permission to modify assigned assets.";
  }

  return error instanceof Error
    ? error.message
    : "Unable to update assigned assets.";
}

function optionLabel(option: {
  name?: string | null;
  code?: string | null;
  email?: string | null;
}) {
  const name = option.name?.trim();
  const code = option.code?.trim();

  if (code && name) {
    return `${code} - ${name}`;
  }

  return name || code || option.email?.trim() || "Not recorded";
}

function metadataEntries(metadata: Record<string, unknown> | null) {
  if (!metadata) {
    return [];
  }

  return Object.entries(metadata)
    .map(([key, value]) => ({
      key,
      value:
        typeof value === "string"
          ? value
          : value === null || value === undefined
            ? ""
            : JSON.stringify(value),
    }))
    .filter((entry) => entry.value.trim());
}

function metadataSummary(session: OperationalSession) {
  const entries = metadataEntries(session.metadata);

  if (entries.length === 0) {
    return "Metadata not recorded";
  }

  return entries.map((entry) => entry.value).join(" / ");
}

function statusBadgeClassName(status: OperationalSessionStatus) {
  if (status === "APPROVED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "CANCELLED") {
    return "border-slate-300 bg-slate-100 text-slate-600";
  }

  if (status === "REJECTED") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (status === "AMENDMENT_REQUIRED") {
    return "border-amber-300 bg-amber-100 text-amber-900";
  }

  if (status === "QA_REVIEW" || status === "SUBMITTED") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (status === "IN_PROGRESS") {
    return "border-teal-200 bg-teal-50 text-teal-700";
  }

  return "border-slate-200 bg-white text-slate-700";
}

function StatusBadge({ status }: { status: OperationalSessionStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadgeClassName(status)}`}
    >
      {formatEnum(status)}
    </span>
  );
}

function actionButtonClassName(tone: DetailAction["tone"]) {
  if (tone === "primary") {
    return "bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]";
  }

  if (tone === "success") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
  }

  if (tone === "warning") {
    return "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100";
  }

  if (tone === "danger") {
    return "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100";
  }

  return "border border-slate-300 bg-white text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)]";
}

function availableActions(status: OperationalSessionStatus): DetailAction[] {
  if (status === "DRAFT" || status === "ASSIGNED") {
    return [
      { action: "start", label: "Start", tone: "primary" },
      { action: "cancel", label: "Cancel", tone: "neutral" },
    ];
  }

  if (status === "IN_PROGRESS") {
    return [
      { action: "submit", label: "Submit", tone: "primary" },
      { action: "cancel", label: "Cancel", tone: "neutral" },
    ];
  }

  if (status === "SUBMITTED") {
    return [{ action: "send-to-qa", label: "Send to QA", tone: "primary" }];
  }

  if (status === "QA_REVIEW") {
    return [
      { action: "approve", label: "Approve", tone: "success" },
      {
        action: "request-amendment",
        label: "Request Amendment",
        tone: "warning",
        requiresComment: true,
      },
      { action: "reject", label: "Reject", tone: "danger", requiresComment: true },
    ];
  }

  if (status === "AMENDMENT_REQUIRED") {
    return [{ action: "start", label: "Start", tone: "primary" }];
  }

  return [];
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className={fieldClassName}>
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function canMutateLifecycle(authSession: AuthSession | null) {
  const sourceRole = authSession?.user?.sourceRole ?? authSession?.user?.role;

  return Boolean(sourceRole && sourceRole !== "VIEWER" && sourceRole !== "CLIENT");
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: typeof CalendarClock;
  tone?: "neutral" | "success" | "warning";
}) {
  const toneClassName =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
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

function ProgressPanel({ session }: { session: OperationalSession }) {
  const percentage = Math.min(Math.max(session.progress.completionPercentage, 0), 100);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Progress</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {session.progress.completedAssets} of {session.progress.totalAssets} assets completed
          </p>
        </div>
        <div className="text-3xl font-bold text-slate-950">{percentage}%</div>
      </div>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[var(--brand)]"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </section>
  );
}

function AssignedAssetsPanel({
  session,
  assets,
  isLoading,
  error,
  notice,
  canMutate,
  removingAssetId,
  onOpenAdd,
  onOpenBulk,
  onRemove,
}: {
  session: OperationalSession;
  assets: OperationalSessionAssignedAsset[];
  isLoading: boolean;
  error: string;
  notice: string;
  canMutate: boolean;
  removingAssetId: string | null;
  onOpenAdd: () => void;
  onOpenBulk: () => void;
  onRemove: (assetId: string) => void;
}) {
  const inspectedAssets = session.progress.inspectedAssets;
  const percentage = Math.min(Math.max(session.progress.completionPercentage, 0), 100);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Assigned Assets</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {assets.length} active assignments
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenAdd}
            disabled={!canMutate}
            className={secondaryButtonClassName}
          >
            <Plus size={16} />
            Add Asset
          </button>
          <button
            type="button"
            onClick={onOpenBulk}
            disabled={!canMutate}
            className={secondaryButtonClassName}
          >
            <Upload size={16} />
            Bulk Assign
          </button>
        </div>
      </div>

      {!canMutate ? (
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          Your current role is read-only for assigned asset changes.
        </p>
      ) : null}

      {notice ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid border-y border-slate-200 text-sm sm:grid-cols-3">
        <div className="py-3 sm:border-r sm:border-slate-200 sm:px-4">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">Total Assigned</p>
          <p className="mt-1 text-xl font-bold text-slate-950">
            {session.progress.totalAssets}
          </p>
        </div>
        <div className="border-t border-slate-200 py-3 sm:border-r sm:border-t-0 sm:border-slate-200 sm:px-4">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">Inspected</p>
          <p className="mt-1 text-xl font-bold text-slate-950">{inspectedAssets}</p>
        </div>
        <div className="border-t border-slate-200 py-3 sm:border-t-0 sm:px-4">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">Completion</p>
          <p className="mt-1 text-xl font-bold text-slate-950">{percentage}%</p>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Asset Code
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Name
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Asset Type
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Status
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Inspected
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Latest Inspection
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Coordinates
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Assigned At
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Notes
              </th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase text-[var(--muted)]">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-3 py-8 text-center text-sm text-[var(--muted)]" colSpan={10}>
                  Loading assigned assets...
                </td>
              </tr>
            ) : assets.length > 0 ? (
              assets.map((asset) => (
                <tr key={asset.assignment.id} className="border-b border-slate-100">
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 font-semibold text-slate-950">
                    {asset.assetCode}
                  </td>
                  <td className="min-w-36 border-b border-slate-100 px-3 py-3 text-slate-700">
                    {asset.name?.trim() || "Not recorded"}
                  </td>
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-slate-700">
                    {optionLabel(asset.assetType)}
                  </td>
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3">
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700">
                      {formatEnum(asset.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-bold ${
                        asset.inspected
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      {asset.inspected ? "Inspected" : "Pending"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-slate-700">
                    {formatEnum(asset.latestInspectionStatus)}
                  </td>
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-slate-700">
                    {formatCoordinates(asset.latitude, asset.longitude)}
                  </td>
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-slate-700">
                    {formatDateTime(asset.assignment.assignedAt)}
                  </td>
                  <td className="min-w-44 border-b border-slate-100 px-3 py-3 text-slate-700">
                    {asset.assignment.notes?.trim() || "Not recorded"}
                  </td>
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onRemove(asset.id)}
                      disabled={!canMutate || removingAssetId === asset.id}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {removingAssetId === asset.id ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-8 text-center text-sm text-[var(--muted)]" colSpan={10}>
                  No assets are assigned to this session.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssetAssignmentModalDialog({
  modal,
  assetIdInput,
  notesInput,
  bulkInput,
  bulkSummary,
  isSubmitting,
  error,
  onAssetIdChange,
  onNotesChange,
  onBulkInputChange,
  onClose,
  onSubmitAdd,
  onSubmitBulk,
}: {
  modal: AssetAssignmentModal;
  assetIdInput: string;
  notesInput: string;
  bulkInput: string;
  bulkSummary: BulkAssignSummary | null;
  isSubmitting: boolean;
  error: string;
  onAssetIdChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onBulkInputChange: (value: string) => void;
  onClose: () => void;
  onSubmitAdd: () => void;
  onSubmitBulk: () => void;
}) {
  if (!modal) {
    return null;
  }

  const isBulk = modal === "bulk";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
              {isBulk ? <Upload size={18} /> : <PackagePlus size={18} />}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                {isBulk ? "Bulk Assign" : "Add Asset"}
              </h3>
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                Assigned Assets
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {isBulk ? (
          <>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase text-[var(--muted)]">
                Asset IDs
              </span>
              <textarea
                value={bulkInput}
                onChange={(event) => onBulkInputChange(event.target.value)}
                rows={7}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-soft)]"
                placeholder="asset-id-1, asset-id-2"
              />
            </label>

            {bulkSummary ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(bulkSummary).map(([key, value]) => (
                  <div key={key} className="border-y border-slate-200 py-3">
                    <p className="text-[11px] font-bold uppercase text-[var(--muted)]">
                      {formatEnum(key)}
                    </p>
                    <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase text-[var(--muted)]">
                Asset ID
              </span>
              <input
                value={assetIdInput}
                onChange={(event) => onAssetIdChange(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-soft)]"
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase text-[var(--muted)]">
                Notes
              </span>
              <textarea
                value={notesInput}
                onChange={(event) => onNotesChange(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-soft)]"
              />
            </label>
          </>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className={secondaryButtonClassName}
          >
            Close
          </button>
          <button
            type="button"
            onClick={isBulk ? onSubmitBulk : onSubmitAdd}
            disabled={isSubmitting}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-3 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? <RefreshCw size={16} className="animate-spin" /> : null}
            {isBulk ? "Bulk Assign" : "Add Asset"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OperationalSessionDetailContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [session, setSession] = useState<OperationalSession | null>(null);
  const [assignedAssets, setAssignedAssets] = useState<OperationalSessionAssignedAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAssetsLoading, setIsAssetsLoading] = useState(false);
  const [runningAction, setRunningAction] =
    useState<OperationalSessionLifecycleAction | null>(null);
  const [commentAction, setCommentAction] = useState<DetailAction | null>(null);
  const [comment, setComment] = useState("");
  const [assetModal, setAssetModal] = useState<AssetAssignmentModal>(null);
  const [assetIdInput, setAssetIdInput] = useState("");
  const [assetNotesInput, setAssetNotesInput] = useState("");
  const [bulkAssetIdsInput, setBulkAssetIdsInput] = useState("");
  const [bulkSummary, setBulkSummary] = useState<BulkAssignSummary | null>(null);
  const [isAssetSubmitting, setIsAssetSubmitting] = useState(false);
  const [removingAssetId, setRemovingAssetId] = useState<string | null>(null);
  const [assetError, setAssetError] = useState("");
  const [assetNotice, setAssetNotice] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadSession = useCallback(
    async (token: string, showLoading = true) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError("");
      setAssetError("");
      setIsAssetsLoading(true);

      try {
        const nextSession = await fetchOperationalSessionDetail(token, sessionId);
        setSession(nextSession);

        try {
          setAssignedAssets(await getSessionAssets(token, sessionId));
        } catch (assetLoadError) {
          if (assetLoadError instanceof ApiError && assetLoadError.status === 401) {
            handleLogout();
            return;
          }

          setAssetError(
            assetLoadError instanceof Error
              ? assetLoadError.message
              : "Unable to load assigned assets.",
          );
          setAssignedAssets([]);
        }
      } catch (sessionError) {
        if (sessionError instanceof ApiError && sessionError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "Unable to load operational session.",
        );
        if (showLoading) {
          setSession(null);
          setAssignedAssets([]);
        }
      } finally {
        if (showLoading) {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
        setIsAssetsLoading(false);
      }
    },
    [handleLogout, sessionId],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setAuthSession(storedSession);

    if (storedSession?.token) {
      void loadSession(storedSession.token);
    }
  }, [loadSession]);

  const actions = useMemo(
    () => (session ? availableActions(session.status) : []),
    [session],
  );
  const metadataRows = metadataEntries(session?.metadata ?? null);
  const canRunLifecycleAction = canMutateLifecycle(authSession);
  const canMutateAssignedAssets = canRunLifecycleAction;

  async function runAction(action: DetailAction, remarks?: string) {
    if (!authSession?.token || !session || runningAction) {
      return;
    }

    setRunningAction(action.action);
    setError("");
    setNotice("");

    try {
      const updatedSession = await runOperationalSessionLifecycleAction(
        authSession.token,
        session.id,
        action.action,
        remarks,
      );
      setSession(updatedSession);
      setCommentAction(null);
      setComment("");
      setNotice(`${action.label} completed.`);
    } catch (actionError) {
      if (actionError instanceof ApiError && actionError.status === 401) {
        handleLogout();
        return;
      }

      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update operational session.",
      );
    } finally {
      setRunningAction(null);
    }
  }

  function handleAction(action: DetailAction) {
    if (action.requiresComment) {
      setCommentAction(action);
      setComment("");
      setError("");
      return;
    }

    void runAction(action);
  }

  function submitCommentAction() {
    if (!commentAction) {
      return;
    }

    const trimmedComment = comment.trim();

    if (!trimmedComment) {
      setError("Remarks are required for this lifecycle action.");
      return;
    }

    void runAction(commentAction, trimmedComment);
  }

  function openAddAssetModal() {
    setAssetModal("add");
    setAssetIdInput("");
    setAssetNotesInput("");
    setBulkSummary(null);
    setAssetError("");
    setAssetNotice("");
  }

  function openBulkAssignModal() {
    setAssetModal("bulk");
    setBulkAssetIdsInput("");
    setBulkSummary(null);
    setAssetError("");
    setAssetNotice("");
  }

  function closeAssetModal() {
    if (isAssetSubmitting) {
      return;
    }

    setAssetModal(null);
    setAssetIdInput("");
    setAssetNotesInput("");
    setBulkAssetIdsInput("");
    setBulkSummary(null);
    setAssetError("");
  }

  async function refreshAfterAssetMutation(token: string) {
    await loadSession(token, false);
  }

  async function submitAddAsset() {
    if (!authSession?.token || !session || isAssetSubmitting) {
      return;
    }

    const assetId = assetIdInput.trim();

    if (!assetId) {
      setAssetError("Asset ID is required.");
      return;
    }

    setIsAssetSubmitting(true);
    setAssetError("");
    setAssetNotice("");

    try {
      await assignSessionAsset(
        authSession.token,
        session.id,
        assetId,
        assetNotesInput.trim() || undefined,
      );
      setAssetModal(null);
      setAssetIdInput("");
      setAssetNotesInput("");
      await refreshAfterAssetMutation(authSession.token);
      setAssetNotice("Asset assigned to session.");
    } catch (assignError) {
      if (assignError instanceof ApiError && assignError.status === 401) {
        handleLogout();
        return;
      }

      setAssetError(assetMutationErrorMessage(assignError));
    } finally {
      setIsAssetSubmitting(false);
    }
  }

  async function submitBulkAssign() {
    if (!authSession?.token || !session || isAssetSubmitting) {
      return;
    }

    const assetIds = parseBulkAssetIds(bulkAssetIdsInput);

    if (assetIds.length === 0) {
      setAssetError("At least one asset ID is required.");
      return;
    }

    setIsAssetSubmitting(true);
    setAssetError("");
    setAssetNotice("");
    setBulkSummary(null);

    try {
      const result = await bulkAssignSessionAssets(authSession.token, session.id, assetIds);
      setBulkSummary(result.summary);
      await refreshAfterAssetMutation(authSession.token);
      setAssetNotice("Bulk assignment completed.");
    } catch (bulkError) {
      if (bulkError instanceof ApiError && bulkError.status === 401) {
        handleLogout();
        return;
      }

      setAssetError(assetMutationErrorMessage(bulkError));
    } finally {
      setIsAssetSubmitting(false);
    }
  }

  async function removeAssignedAsset(assetId: string) {
    if (!authSession?.token || !session || removingAssetId || isAssetSubmitting) {
      return;
    }

    setRemovingAssetId(assetId);
    setAssetError("");
    setAssetNotice("");

    try {
      await removeSessionAsset(authSession.token, session.id, assetId);
      await refreshAfterAssetMutation(authSession.token);
      setAssetNotice("Asset removed from session.");
    } catch (removeError) {
      if (removeError instanceof ApiError && removeError.status === 401) {
        handleLogout();
        return;
      }

      setAssetError(assetMutationErrorMessage(removeError));
    } finally {
      setRemovingAssetId(null);
    }
  }

  return (
    <AppShell user={authSession?.user ?? null} onLogout={handleLogout}>
      <AssetAssignmentModalDialog
        modal={assetModal}
        assetIdInput={assetIdInput}
        notesInput={assetNotesInput}
        bulkInput={bulkAssetIdsInput}
        bulkSummary={bulkSummary}
        isSubmitting={isAssetSubmitting}
        error={assetModal ? assetError : ""}
        onAssetIdChange={setAssetIdInput}
        onNotesChange={setAssetNotesInput}
        onBulkInputChange={setBulkAssetIdsInput}
        onClose={closeAssetModal}
        onSubmitAdd={() => {
          void submitAddAsset();
        }}
        onSubmitBulk={() => {
          void submitBulkAssign();
        }}
      />
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.push("/operational-sessions")}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
              >
                <ArrowLeft size={16} />
                Operations / Sessions
              </button>
              <p className="mt-4 text-sm font-semibold uppercase text-[var(--brand)]">
                Session Detail
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {session?.sessionNo ?? "Operational Session"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {canRunLifecycleAction ? "Lifecycle access" : "Read-only"}
                </span>
                {session ? <StatusBadge status={session.status} /> : null}
                {session ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                    {formatEnum(session.scope)}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                authSession?.token ? loadSession(authSession.token, false) : undefined
              }
              disabled={(isLoading && !session) || isRefreshing || !authSession?.token}
              className={secondaryButtonClassName}
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && !session ? (
              <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="h-8 w-72 animate-pulse rounded-md bg-slate-100" />
                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              </div>
            ) : error && !session ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : session ? (
              <div className="space-y-6">
                {notice ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                    {notice}
                  </div>
                ) : null}
                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile
                    label="Completion"
                    value={`${session.progress.completionPercentage}%`}
                    icon={CheckCircle2}
                    tone="success"
                  />
                  <MetricTile
                    label="Total Assets"
                    value={session.progress.totalAssets}
                    icon={CalendarClock}
                  />
                  <MetricTile
                    label="Due Date"
                    value={formatDateTime(session.dueDate)}
                    icon={Clock3}
                    tone={session.dueDate ? "warning" : "neutral"}
                  />
                  <MetricTile
                    label="Updated"
                    value={formatDateTime(session.updatedAt)}
                    icon={RefreshCw}
                  />
                </div>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-6">
                    <ProgressPanel session={session} />

                    <AssignedAssetsPanel
                      session={session}
                      assets={assignedAssets}
                      isLoading={isAssetsLoading}
                      error={!assetModal ? assetError : ""}
                      notice={assetNotice}
                      canMutate={canMutateAssignedAssets}
                      removingAssetId={removingAssetId}
                      onOpenAdd={openAddAssetModal}
                      onOpenBulk={openBulkAssignModal}
                      onRemove={(assetId) => {
                        void removeAssignedAsset(assetId);
                      }}
                    />

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <h2 className="text-base font-semibold text-slate-950">Session Header</h2>
                      <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <DetailField label="Scope" value={formatEnum(session.scope)} />
                        <DetailField label="Status" value={formatEnum(session.status)} />
                        <DetailField
                          label="Company"
                          value={optionLabel(session.assignedCompany ?? {})}
                        />
                        <DetailField
                          label="QA/QC"
                          value={optionLabel(session.assignedQaUser ?? {})}
                        />
                        <DetailField
                          label="MAINHEAD"
                          value={optionLabel(session.mainhead ?? {})}
                        />
                        <DetailField
                          label="Organization"
                          value={optionLabel(session.organization ?? {})}
                        />
                        <DetailField
                          label="Branch"
                          value={optionLabel(session.branch ?? {})}
                        />
                        <DetailField
                          label="Target Date"
                          value={formatDateTime(session.targetDate)}
                        />
                        <DetailField label="Due Date" value={formatDateTime(session.dueDate)} />
                      </dl>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <h2 className="text-base font-semibold text-slate-950">
                        Metadata Summary
                      </h2>
                      <p className="mt-2 text-sm font-semibold text-slate-800">
                        {metadataSummary(session)}
                      </p>
                      <dl className="mt-5 grid gap-4 md:grid-cols-2">
                        {metadataRows.length > 0 ? (
                          metadataRows.map((entry) => (
                            <DetailField
                              key={entry.key}
                              label={formatEnum(entry.key)}
                              value={entry.value}
                            />
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)] md:col-span-2">
                            No metadata recorded for this session.
                          </div>
                        )}
                      </dl>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <h2 className="text-base font-semibold text-slate-950">
                        Remarks & Timestamps
                      </h2>
                      <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <DetailField label="Remarks" value={session.remarks ?? "Not recorded"} />
                        <DetailField label="Started" value={formatDateTime(session.startedAt)} />
                        <DetailField
                          label="Submitted"
                          value={formatDateTime(session.submittedAt)}
                        />
                        <DetailField
                          label="Approved"
                          value={formatDateTime(session.approvedAt)}
                        />
                        <DetailField
                          label="Rejected"
                          value={formatDateTime(session.rejectedAt)}
                        />
                        <DetailField label="Created" value={formatDateTime(session.createdAt)} />
                      </dl>
                    </section>
                  </div>

                  <aside className="space-y-6">
                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <h2 className="text-base font-semibold text-slate-950">
                        Lifecycle Actions
                      </h2>
                      <div className="mt-4 grid gap-2">
                        {actions.length > 0 ? (
                          actions.map((action) => (
                            <button
                              key={action.action}
                              type="button"
                              onClick={() => handleAction(action)}
                              disabled={!canRunLifecycleAction || runningAction !== null}
                              className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold shadow-[var(--shadow-soft)] transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${actionButtonClassName(action.tone)}`}
                            >
                              {runningAction === action.action ? (
                                <RefreshCw size={16} className="animate-spin" />
                              ) : action.action === "approve" ? (
                                <CheckCircle2 size={16} />
                              ) : action.action === "reject" ? (
                                <XCircle size={16} />
                              ) : (
                                <Send size={16} />
                              )}
                              {action.label}
                            </button>
                          ))
                        ) : (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-[var(--muted)]">
                            This session is in a final or waiting state with no direct action.
                          </div>
                        )}
                      </div>

                      {!canRunLifecycleAction ? (
                        <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                          Your current role is read-only for lifecycle actions.
                        </p>
                      ) : null}
                    </section>

                    {commentAction ? (
                      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-[var(--shadow-soft)]">
                        <h3 className="text-sm font-bold text-amber-950">
                          {commentAction.label}
                        </h3>
                        <label className="mt-4 block">
                          <span className="mb-1.5 block text-[11px] font-bold uppercase text-amber-900">
                            Remarks
                          </span>
                          <textarea
                            value={comment}
                            onChange={(event) => setComment(event.target.value)}
                            rows={4}
                            className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
                          />
                        </label>
                        <div className="mt-4 flex gap-2">
                          <button
                            type="button"
                            onClick={submitCommentAction}
                            disabled={runningAction !== null}
                            className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold shadow-[var(--shadow-soft)] transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${actionButtonClassName(commentAction.tone)}`}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCommentAction(null);
                              setComment("");
                            }}
                            disabled={runningAction !== null}
                            className="inline-flex h-10 items-center justify-center rounded-md border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-900 shadow-[var(--shadow-soft)] transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            Cancel
                          </button>
                        </div>
                      </section>
                    ) : null}
                  </aside>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)] shadow-[var(--shadow-card)]">
                Operational session not found.
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function OperationalSessionDetailClient({ sessionId }: { sessionId: string }) {
  return (
    <AuthGuard>
      <OperationalSessionDetailContent sessionId={sessionId} />
    </AuthGuard>
  );
}
