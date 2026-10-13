"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { DialogFrame, ErrorBanner, checkboxClass } from "@/components/maintenance-packages-shared";
import { Card, Chip, PageHeader, Tbtn, filterControlClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  fetchClientSupervisors,
  setSupervisorCompanies,
  type ClientSupervisor,
  type ClientSupervisorsResponse,
} from "@/lib/client-supervisors";
import type { AuthSession } from "@/types/auth";

/**
 * TNB Supervisors and the contractor companies each one handles
 * (docs/PLAN-maintenance-flow.md §19, N55). ADMIN sees every TNB Supervisor; a
 * TNB Foreman / Technician those of its own TNB organization. A Supervisor
 * sees, assigns and verifies only its companies' maintenance work.
 */
function TnbSupervisorsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [data, setData] = useState<ClientSupervisorsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<ClientSupervisor | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const load = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        setData(await fetchClientSupervisors(token));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load the TNB Supervisors.");
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (stored?.token) void load(stored.token);
  }, [load]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-5xl">
          <PageHeader
            eyebrow="TNB"
            title="TNB Supervisors"
            subtitle="Give each Supervisor the contractor companies they handle. A Supervisor sees, assigns and verifies the maintenance work of those companies only — with no company, they see nothing."
            actions={
              <Tbtn onClick={() => (session?.token ? load(session.token) : undefined)} disabled={isLoading}>
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6 space-y-3">
            {notice ? (
              <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-[13px] text-[var(--foreground-soft)]">
                {notice}
              </div>
            ) : null}
            <ErrorBanner error={error} />

            {data && data.supervisors.length === 0 ? (
              <Card className="px-5 py-10 text-center">
                <ShieldCheck size={22} className="mx-auto text-[var(--muted)]" />
                <p className="mt-3 text-[13px] font-semibold text-[var(--foreground)]">No TNB Supervisors yet</p>
                <p className="mt-1 text-[12.5px] text-[var(--muted)]">
                  An admin creates the user (role Client, TNB organization) and sets TNB Rank to Supervisor.
                </p>
              </Card>
            ) : null}

            {data?.supervisors.map((supervisor) => (
              <Card key={supervisor.userId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-[var(--foreground)]">
                      {supervisor.name}
                      {!supervisor.isActive ? (
                        <span className="ml-2 align-middle">
                          <Chip tone="neutral">Inactive</Chip>
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-[12.5px] text-[var(--muted)]">
                      {supervisor.email}
                      {supervisor.tnb ? ` · ${supervisor.tnb.name}` : ""}
                    </p>
                  </div>
                  <Tbtn
                    variant="primary"
                    onClick={() => {
                      setNotice("");
                      setEditing(supervisor);
                    }}
                    className="w-full sm:w-auto"
                  >
                    Edit companies
                  </Tbtn>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {supervisor.companies.length === 0 ? (
                    <Chip tone="warning">No company yet — sees nothing</Chip>
                  ) : (
                    supervisor.companies.map((company) => (
                      <Chip key={company.id} tone={company.isActive === false ? "neutral" : "brand"}>
                        {company.name}
                        {company.isActive === false ? " (inactive)" : ""}
                      </Chip>
                    ))
                  )}
                </div>
              </Card>
            ))}

            {isLoading && !data ? (
              <Card className="px-5 py-10 text-center text-[13px] text-[var(--muted)]">Loading…</Card>
            ) : null}
          </div>
        </div>
      </main>

      {editing && data && session?.token ? (
        <CompaniesDialog
          supervisor={editing}
          companies={data.companies}
          token={session.token}
          onClose={() => setEditing(null)}
          onUnauthorized={handleLogout}
          onSaved={(updated) => {
            setEditing(null);
            setNotice(
              `${updated.name} now handles ${updated.companies.length} compan${updated.companies.length === 1 ? "y" : "ies"}.`,
            );
            setData((current) =>
              current
                ? {
                    ...current,
                    supervisors: current.supervisors.map((row) => (row.userId === updated.userId ? updated : row)),
                  }
                : current,
            );
          }}
        />
      ) : null}
    </AppShell>
  );
}

function CompaniesDialog({
  supervisor,
  companies,
  token,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  supervisor: ClientSupervisor;
  companies: ClientSupervisorsResponse["companies"];
  token: string;
  onClose: () => void;
  onSaved: (updated: ClientSupervisor) => void;
  onUnauthorized: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(supervisor.companies.map((company) => company.id)));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return companies.filter(
      (company) =>
        !query || company.name.toLowerCase().includes(query) || (company.code ?? "").toLowerCase().includes(query),
    );
  }, [companies, search]);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      onSaved(await setSupervisorCompanies(token, supervisor.userId, [...picked]));
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        onUnauthorized();
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      eyebrow="TNB Supervisor"
      title={supervisor.name}
      subtitle="Tick the contractor companies this Supervisor handles."
      onClose={busy ? () => undefined : onClose}
    >
      <div className="space-y-3 px-[18px] py-4">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search companies"
          aria-label="Search companies"
          className={`${filterControlClass} w-full`}
        />
        <p className="text-[12px] text-[var(--muted)]">
          {picked.size} selected · {companies.length} contractor compan{companies.length === 1 ? "y" : "ies"}
        </p>
        <ul className="max-h-[50vh] divide-y divide-[var(--line2)] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--line)]">
          {shown.map((company) => (
            <li key={company.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-[var(--panel-muted)]">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={picked.has(company.id)}
                  onChange={() => toggle(company.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[var(--foreground)]">{company.name}</span>
                  <span className="text-[11.5px] text-[var(--muted)]">
                    {company.type === "MAIN_CONTRACTOR" ? "Main contractor" : "Subcontractor"}
                    {company.code ? ` · ${company.code}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12.5px] text-[var(--muted)]">No company matches.</li>
          ) : null}
        </ul>
        <ErrorBanner error={error} />
        <div className="flex gap-2">
          <Tbtn onClick={onClose} disabled={busy} className="flex-1">
            Cancel
          </Tbtn>
          <Tbtn variant="primary" onClick={() => void save()} disabled={busy} className="flex-1">
            {busy ? "Saving…" : "Save"}
          </Tbtn>
        </div>
      </div>
    </DialogFrame>
  );
}

export function TnbSupervisorsClient() {
  return (
    <AuthGuard>
      <TnbSupervisorsContent />
    </AuthGuard>
  );
}
