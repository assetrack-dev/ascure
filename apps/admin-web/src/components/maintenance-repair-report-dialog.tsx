"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  DialogFrame,
  ErrorBanner,
  modalLabelClass,
  modalSelectClass,
} from "@/components/maintenance-packages-shared";
import { Tbtn } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  downloadRepairReport,
  downloadRepairReportsZipFile,
  fetchRepairReportsZipStatus,
  startRepairReportsZip,
  type RepairZipJobStatus,
} from "@/lib/maintenance-packages";
import type {
  MaintenanceCategory,
  MaintenancePackageBoard,
  PackagePencawang,
} from "@/types/maintenance-packages";

/** Companies with work on these Pencawang that the caller may report on. */
function companiesOf(rows: PackagePencawang[], board: MaintenancePackageBoard) {
  const inReach = new Set(board.companies.map((company) => company.id));
  const found = new Map<string, string>();
  for (const row of rows) {
    for (const owner of [...row.packages, ...row.poleSplits]) {
      if (inReach.has(owner.organization.id)) found.set(owner.organization.id, owner.organization.name);
    }
    for (const lane of row.lanes) {
      if (lane.organization && inReach.has(lane.organization.id)) {
        found.set(lane.organization.id, lane.organization.name);
      }
    }
  }
  return [...found.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function label(row: PackagePencawang) {
  return row.pencawangName || row.pencawangCode || "Pencawang";
}

/**
 * Repair report (docs/PLAN-maintenance-flow.md §16): one Pencawang → a PDF,
 * several → a ZIP built in the background. One company per report; optionally
 * one work type (e.g. a Rentis claim). DRAF until every Kejanggalan is closed.
 */
export function RepairReportDialog({
  token,
  rows,
  board,
  onClose,
  onUnauthorized,
}: {
  token: string;
  rows: PackagePencawang[];
  board: MaintenancePackageBoard;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const single = rows.length === 1;
  const companies = useMemo(() => companiesOf(rows, board), [board, rows]);
  // A company's own staff always report on their own company.
  const fixedCompany = board.actorKind === "COMPANY" || companies.length === 1;
  const [organizationId, setOrganizationId] = useState(fixedCompany ? companies[0]?.id ?? "" : "");
  const [category, setCategory] = useState<MaintenanceCategory | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<{ id: string; status: RepairZipJobStatus } | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    },
    [],
  );

  const fail = (failure: unknown, fallback: string) => {
    if (failure instanceof ApiError && failure.status === 401) {
      onUnauthorized();
      return;
    }
    setError(failure instanceof Error ? failure.message : fallback);
  };

  const options = { organizationId: organizationId || null, category: category || null };

  const downloadOne = async () => {
    setBusy(true);
    setError("");
    try {
      await downloadRepairReport(token, rows[0].siteVisitId, options);
      onClose();
    } catch (failure) {
      fail(failure, "Unable to build the repair report.");
    } finally {
      setBusy(false);
    }
  };

  const poll = (jobId: string) => {
    pollRef.current = window.setTimeout(async () => {
      try {
        const status = await fetchRepairReportsZipStatus(token, jobId);
        setJob({ id: jobId, status });
        if (status.status === "RUNNING") poll(jobId);
        else setBusy(false);
      } catch (failure) {
        setBusy(false);
        fail(failure, "Lost track of the ZIP job.");
      }
    }, 1500);
  };

  const startZip = async () => {
    setBusy(true);
    setError("");
    try {
      const started = await startRepairReportsZip(
        token,
        rows.map((row) => row.siteVisitId),
        options,
      );
      setJob({
        id: started.jobId,
        status: { status: "RUNNING", processed: 0, total: started.total, currentLabel: null, error: null },
      });
      poll(started.jobId);
    } catch (failure) {
      setBusy(false);
      fail(failure, "Unable to start the ZIP.");
    }
  };

  const downloadZip = async () => {
    if (!job) return;
    try {
      await downloadRepairReportsZipFile(token, job.id);
      onClose();
    } catch (failure) {
      fail(failure, "Unable to download the ZIP.");
    }
  };

  const needsCompany = single && !organizationId && companies.length > 1;

  return (
    <DialogFrame
      eyebrow="Repair report"
      title={single ? label(rows[0]) : `${rows.length} Pencawang`}
      subtitle="Laporan Pembaikan Kejanggalan — every Kejanggalan of one company with its before / during / after photos. Marked DRAF until all are closed."
      onClose={busy ? () => undefined : onClose}
    >
      <div className="space-y-4 px-[18px] py-5">
        <ErrorBanner error={error} />

        {companies.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            No company in your reach has work on {single ? "this Pencawang" : "these Pencawang"} yet.
          </p>
        ) : fixedCompany ? (
          <p className="text-[13px] text-[var(--foreground-soft)]">
            Company: <span className="font-semibold">{companies.find((company) => company.id === organizationId)?.name}</span>
          </p>
        ) : (
          <label className="block">
            <span className={modalLabelClass}>Company</span>
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              className={modalSelectClass}
            >
              <option value="">{single ? "Choose a company…" : "Each Pencawang's own company"}</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            {!single && !organizationId ? (
              <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
                A Pencawang shared by several companies is skipped and listed in SENARAI.txt — pick a company to include it.
              </span>
            ) : null}
          </label>
        )}

        <label className="block">
          <span className={modalLabelClass}>Work type</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as MaintenanceCategory | "")}
            className={modalSelectClass}
          >
            <option value="">All work types</option>
            {CATEGORY_ORDER.map((type) => (
              <option key={type} value={type}>
                {CATEGORY_LABEL[type]} only
              </option>
            ))}
          </select>
        </label>

        {job ? (
          <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-3 py-2.5 text-[12.5px] text-[var(--foreground-soft)]">
            {job.status.status === "RUNNING"
              ? `Building ${job.status.processed} / ${job.status.total}${job.status.currentLabel ? ` — ${job.status.currentLabel}` : ""}…`
              : job.status.status === "COMPLETED"
                ? `Ready — ${job.status.total} Pencawang.`
                : `Failed: ${job.status.error ?? "unknown error"}`}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-[var(--line2)] pt-4">
          <Tbtn type="button" onClick={onClose} disabled={busy}>
            Close
          </Tbtn>
          {single ? (
            <Tbtn
              variant="primary"
              onClick={() => void downloadOne()}
              disabled={busy || companies.length === 0 || needsCompany}
            >
              <FileText size={16} />
              {busy ? "Building…" : "Download PDF"}
            </Tbtn>
          ) : job?.status.status === "COMPLETED" ? (
            <Tbtn variant="primary" onClick={() => void downloadZip()}>
              <Download size={16} />
              Download ZIP
            </Tbtn>
          ) : (
            <Tbtn
              variant="primary"
              onClick={() => void startZip()}
              disabled={busy || companies.length === 0 || rows.length > 40}
            >
              <FileText size={16} />
              {busy ? "Building…" : rows.length > 40 ? "Max 40 Pencawang" : `Build ZIP (${rows.length})`}
            </Tbtn>
          )}
        </div>
      </div>
    </DialogFrame>
  );
}
