"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  fetchTeamSupervisors,
  setTeamSupervisors,
  type TeamSupervisorUser,
} from "@/lib/team-supervisors";

interface TeamSupervisorsDialogProps {
  token: string;
  teamId: string;
  teamName: string;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Manage the supervisor↔team links for one team (ADR 0002 §3). The picker shows
 * the eligible pool (active SUPERVISOR-role users in the team's company) plus any
 * current supervisor who has since fallen out of it, so links can always be
 * removed. Gated by the server `canManageSupervisors` flag at the call site.
 */
export function TeamSupervisorsDialog({
  token,
  teamId,
  teamName,
  onClose,
  onSaved,
}: TeamSupervisorsDialogProps) {
  const [candidates, setCandidates] = useState<TeamSupervisorUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError("");

      try {
        const view = await fetchTeamSupervisors(token, teamId);
        if (cancelled) {
          return;
        }

        const byId = new Map<string, TeamSupervisorUser>();
        for (const user of [...view.candidates, ...view.supervisors]) {
          byId.set(user.id, user);
        }

        setCandidates(
          Array.from(byId.values()).sort((a, b) =>
            (a.name || a.email).localeCompare(b.name || b.email),
          ),
        );
        setSelectedIds(new Set(view.supervisors.map((user) => user.id)));
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof ApiError
              ? caught.message
              : "Unable to load supervisors.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [token, teamId]);

  function toggle(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function handleSave() {
    setIsSaving(true);
    setError("");

    try {
      await setTeamSupervisors(token, teamId, Array.from(selectedIds));
      onSaved?.();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Unable to save supervisors.",
      );
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand)]">
              Supervisors
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{teamName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            aria-label="Close supervisors dialog"
          >
            <X size={17} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm text-[var(--muted)]">
            Supervisors see and can reassign this team&apos;s work across their
            company, regardless of MAINHEAD or region.
          </p>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted)]">
              <Loader2 size={16} className="animate-spin" />
              Loading supervisors…
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-[var(--muted)]">
              No eligible supervisors in this team&apos;s organization. Add a user
              with the Supervisor role to the same company first.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((user) => (
                <li key={user.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition hover:border-[var(--brand)]">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(user.id)}
                      onChange={(event) => toggle(user.id, event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">
                        {user.name || user.email}
                      </span>
                      {user.email ? (
                        <span className="block truncate text-xs text-[var(--muted)]">
                          {user.email}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
          <span className="text-xs font-semibold text-[var(--muted)]">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <ShieldCheck size={15} />
              )}
              Save supervisors
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
