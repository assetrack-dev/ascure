"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import {
  DialogFrame,
  ErrorBanner,
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
} from "@/components/maintenance-packages-shared";
import { Tbtn } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { downloadMaterialsSummary } from "@/lib/maintenance-materials";
import type { PackageCompany } from "@/types/maintenance-packages";

function today() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The materials claim summary (TNB feedback #1): Excel with three sheets —
 * per Pencawang, total for the period, per Kejanggalan — for Kejanggalan
 * repaired in the chosen dates.
 */
export function MaterialsSummaryDialog({
  token,
  companies,
  fixedCompany,
  onClose,
  onUnauthorized,
}: {
  token: string;
  companies: PackageCompany[];
  /** A contractor's own staff always get their own company. */
  fixedCompany: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const end = today();
  const [from, setFrom] = useState(`${end.slice(0, 8)}01`);
  const [to, setTo] = useState(end);
  const [organizationId, setOrganizationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!from || !to || from > to) {
      setError("Pick a start date on or before the end date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await downloadMaterialsSummary(token, { from, to, organizationId: organizationId || null });
      onClose();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        onUnauthorized();
        return;
      }
      setError(failure instanceof Error ? failure.message : "Could not download the summary.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      eyebrow="Bahan digunakan"
      title="Materials summary (Excel)"
      subtitle="For the TNB claim: per Pencawang, the total for the period, and every Kejanggalan — for repairs done between these dates."
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4 px-[18px] py-4">
        <ErrorBanner error={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={modalLabelClass}>Repaired from</span>
            <input type="date" className={modalInputClass} value={from} onChange={(event) => setFrom(event.target.value)} required />
          </label>
          <label className="block">
            <span className={modalLabelClass}>to</span>
            <input type="date" className={modalInputClass} value={to} onChange={(event) => setTo(event.target.value)} required />
          </label>
        </div>
        {!fixedCompany && companies.length > 1 ? (
          <label className="block">
            <span className={modalLabelClass}>Company</span>
            <select
              className={modalSelectClass}
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              <option value="">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Tbtn variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Tbtn>
          <Tbtn variant="primary" type="submit" disabled={busy}>
            {busy ? "Preparing…" : "Download Excel"}
          </Tbtn>
        </div>
      </form>
    </DialogFrame>
  );
}
