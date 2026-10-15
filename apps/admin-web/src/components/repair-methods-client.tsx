"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ErrorBanner, checkboxClass } from "@/components/maintenance-packages-shared";
import { Card, Chip, PageHeader, Tbtn, filterControlClass, filterSelectClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  createRepairMethod,
  fetchRepairMethodsAdmin,
  updateRepairMethod,
  type RepairMethod,
  type RepairMethodAdminRow,
} from "@/lib/maintenance-corrections";
import type { AuthSession } from "@/types/auth";

const WORK_TYPES: Array<{ value: RepairMethod["category"]; label: string }> = [
  { value: "RENTIS", label: "Rentis" },
  { value: "CAT_TIANG", label: "Cat tiang" },
  { value: "SELENGGARAAN", label: "Selenggaraan" },
];

/**
 * ADMIN: the kinds of repair a crew picks at "Mark done" (plan §20, P2 —
 * Rentis: KAEDAH LAZIM, KAEDAH A.B.C, ULAN/CREEPERS, TEBANG POKOK, Lain-lain).
 * A work type with no active type shows no picker. Retire, don't delete: past
 * repairs keep the type they were recorded with.
 */
function RepairMethodsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [rows, setRows] = useState<RepairMethodAdminRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ category: RepairMethod["category"]; label: string; requiresNote: boolean }>({
    category: "RENTIS",
    label: "",
    requiresNote: false,
  });
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const fail = useCallback(
    (failure: unknown, fallback: string) => {
      if (failure instanceof ApiError && failure.status === 401) {
        handleLogout();
        return;
      }
      setError(failure instanceof Error ? failure.message : fallback);
    },
    [handleLogout],
  );

  const load = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        setRows(await fetchRepairMethodsAdmin(token));
      } catch (failure) {
        fail(failure, "Unable to load the repair types.");
      } finally {
        setIsLoading(false);
      }
    },
    [fail],
  );

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (stored?.token) void load(stored.token);
  }, [load]);

  const token = session?.token ?? null;

  const save = async (id: string, input: Parameters<typeof updateRepairMethod>[2]) => {
    if (!token) return;
    setBusyId(id);
    setError("");
    try {
      await updateRepairMethod(token, id, input);
      await load(token);
    } catch (failure) {
      fail(failure, "Could not save.");
    } finally {
      setBusyId(null);
    }
  };

  const move = async (list: RepairMethodAdminRow[], index: number, direction: -1 | 1) => {
    const other = list[index + direction];
    const row = list[index];
    if (!token || !other) return;
    setBusyId(row.id);
    try {
      // Swap positions; equal numbers get spread out first.
      const rowOrder = other.sortOrder === row.sortOrder ? row.sortOrder + direction * 5 : other.sortOrder;
      await updateRepairMethod(token, row.id, { sortOrder: Math.max(0, rowOrder) });
      await updateRepairMethod(token, other.id, { sortOrder: row.sortOrder });
      await load(token);
    } catch (failure) {
      fail(failure, "Could not reorder.");
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    if (!token || !draft.label.trim()) return;
    setBusyId("new");
    setError("");
    try {
      await createRepairMethod(token, { ...draft, label: draft.label.trim() });
      setDraft((current) => ({ ...current, label: "", requiresNote: false }));
      await load(token);
    } catch (failure) {
      fail(failure, "Could not add the repair type.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-4xl">
          <PageHeader
            eyebrow="Setup"
            title="Repair types"
            subtitle="What the crew picks when marking a repair done — e.g. the kind of Rentis. Shown in Repair Verification, the repair report and Crew Performance. Retire a type instead of renaming its meaning: past repairs keep their type."
            actions={
              <Tbtn onClick={() => (token ? load(token) : undefined)} disabled={isLoading}>
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6 space-y-4">
            <ErrorBanner error={error} />

            <Card>
              <p className="text-[13px] font-semibold text-[var(--foreground)]">Add a repair type</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  aria-label="Work type"
                  value={draft.category}
                  onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as RepairMethod["category"] }))}
                  className={filterSelectClass}
                >
                  {WORK_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <input
                  value={draft.label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                  placeholder="Name, e.g. POTONG DAHAN"
                  maxLength={80}
                  className={`${filterControlClass} flex-1`}
                />
                <label className="inline-flex items-center gap-2 text-[12.5px] text-[var(--foreground-soft)]">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={draft.requiresNote}
                    onChange={(event) => setDraft((current) => ({ ...current, requiresNote: event.target.checked }))}
                  />
                  Crew must describe it
                </label>
                <Tbtn variant="primary" onClick={() => void add()} disabled={!draft.label.trim() || busyId === "new"}>
                  <Plus size={16} /> Add
                </Tbtn>
              </div>
            </Card>

            {WORK_TYPES.map((type) => {
              const list = (rows ?? []).filter((row) => row.category === type.value);
              return (
                <Card key={type.value}>
                  <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
                    {type.label}
                  </p>
                  {list.length === 0 ? (
                    <p className="mt-2 text-[12.5px] text-[var(--muted)]">No types — the crew sees no picker for {type.label}.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-[var(--line)]">
                      {list.map((row, index) => (
                        <li key={row.id} className="flex flex-wrap items-center gap-2 py-2.5">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              aria-label="Move up"
                              disabled={index === 0 || busyId !== null}
                              onClick={() => void move(list, index, -1)}
                              className="rounded-[7px] border border-[var(--line)] p-1 disabled:opacity-30"
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              type="button"
                              aria-label="Move down"
                              disabled={index === list.length - 1 || busyId !== null}
                              onClick={() => void move(list, index, 1)}
                              className="rounded-[7px] border border-[var(--line)] p-1 disabled:opacity-30"
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>
                          {renaming?.id === row.id ? (
                            <span className="flex flex-1 gap-2">
                              <input
                                value={renaming.label}
                                onChange={(event) => setRenaming({ id: row.id, label: event.target.value })}
                                maxLength={80}
                                className={`${filterControlClass} flex-1`}
                                autoFocus
                              />
                              <Tbtn
                                variant="primary"
                                onClick={() => {
                                  void save(row.id, { label: renaming.label.trim() });
                                  setRenaming(null);
                                }}
                                disabled={!renaming.label.trim()}
                              >
                                Save
                              </Tbtn>
                              <Tbtn onClick={() => setRenaming(null)}>Cancel</Tbtn>
                            </span>
                          ) : (
                            <button
                              type="button"
                              title="Rename"
                              onClick={() => setRenaming({ id: row.id, label: row.label })}
                              className={`flex-1 text-left text-[13.5px] font-semibold ${row.isActive ? "text-[var(--foreground)]" : "text-[var(--muted)] line-through"}`}
                            >
                              {row.label}
                            </button>
                          )}
                          <span className="text-[11.5px] text-[var(--muted)]">used {row.usedCount}×</span>
                          <label className="inline-flex items-center gap-1.5 text-[12px] text-[var(--foreground-soft)]">
                            <input
                              type="checkbox"
                              className={checkboxClass}
                              checked={row.requiresNote}
                              disabled={busyId !== null}
                              onChange={(event) => void save(row.id, { requiresNote: event.target.checked })}
                            />
                            Must describe
                          </label>
                          {row.isActive ? (
                            <Tbtn onClick={() => void save(row.id, { isActive: false })} disabled={busyId !== null}>
                              Retire
                            </Tbtn>
                          ) : (
                            <>
                              <Chip tone="neutral">Retired</Chip>
                              <Tbtn onClick={() => void save(row.id, { isActive: true })} disabled={busyId !== null}>
                                Restore
                              </Tbtn>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function RepairMethodsClient() {
  return (
    <AuthGuard>
      <RepairMethodsContent />
    </AuthGuard>
  );
}
