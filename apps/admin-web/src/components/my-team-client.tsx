"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, ListChecks, MapPinned, RefreshCw, Undo2, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardHead, Chip, KpiCard, PageHeader, Tbtn, type Tone } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchMyTeam } from "@/lib/my-team";
import type { AuthSession } from "@/types/auth";
import type { MyTeam } from "@/types/my-team";
import type { TaskStatus } from "@/types/maintenance-tasks";

/**
 * Plan §21 (R5) — the field crew's small read-only web view. The phone app is
 * where the work is done; this page shows a technician or viewer their team,
 * the team's surveys still open (the DC's amendment requests first, with the
 * remark), poles inspected, and — for a technician — their maintenance tasks.
 */

const TASK_CHIPS: Array<{ status: TaskStatus; label: string; tone: Tone }> = [
  { status: "SENT_BACK", label: "sent back", tone: "critical" },
  { status: "TODO", label: "to do", tone: "neutral" },
  { status: "IN_PROGRESS", label: "in progress", tone: "info" },
  { status: "COMPLETED", label: "waiting for TNB", tone: "brand" },
  { status: "VERIFIED", label: "verified", tone: "success" },
];

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function MyTeamContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [data, setData] = useState<MyTeam | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const load = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        setData(await fetchMyTeam(token));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load your team.");
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (storedSession?.token) void load(storedSession.token);
  }, [load]);

  const teamNames = data?.teams.map((team) => team.name).join(", ");

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-5xl">
          <PageHeader
            eyebrow="My team"
            title={teamNames || "My team"}
            subtitle="Your team's work at a glance. Do the work in the ASCURE app on your phone; this page is to look, not to change."
            actions={
              <Tbtn
                onClick={() => (session?.token ? load(session.token) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          {error ? (
            <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-4 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          {data ? (
            data.teams.length === 0 ? (
              <Card className="mt-6 px-5 py-10 text-center text-[13px] text-[var(--muted)]">
                You are not in a team yet. Ask your manager to add you to one.
              </Card>
            ) : (
              <div className="mt-6 space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <KpiCard
                    label="Poles inspected today"
                    icon={ClipboardCheck}
                    tone="brand"
                    value={data.inspected.today.team.toLocaleString()}
                    context={`${data.inspected.today.mine.toLocaleString()} by you`}
                  />
                  <KpiCard
                    label="Last 7 days"
                    icon={ClipboardCheck}
                    value={data.inspected.week.team.toLocaleString()}
                    context={`${data.inspected.week.mine.toLocaleString()} by you`}
                  />
                </div>

                {data.maintenance ? (
                  <Card>
                    <CardHead
                      title="Maintenance work"
                      actions={
                        <a
                          href="/maintenance-tasks"
                          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--brand-strong)] hover:underline"
                        >
                          <ListChecks size={14} />
                          Open My tasks
                        </a>
                      }
                    />
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {TASK_CHIPS.filter((chip) => (data.maintenance?.counts[chip.status] ?? 0) > 0).map((chip) => (
                        <Chip key={chip.status} tone={chip.tone}>
                          {data.maintenance?.counts[chip.status]} {chip.label}
                        </Chip>
                      ))}
                    </div>
                  </Card>
                ) : null}

                <Card>
                  <CardHead title="Surveys still open" hint="In the field, or sent back by the document controller." />
                  {data.openSurveys.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {data.openSurveys.map((survey) => (
                        <li key={survey.id}>
                          <a
                            href={`/site-visits/${encodeURIComponent(survey.id)}`}
                            className={`block rounded-[var(--radius-control)] border p-3 transition hover:bg-[var(--panel-muted)] ${
                              survey.amendment ? "border-[var(--critical-border)]" : "border-[var(--line)]"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <MapPinned size={15} className="shrink-0 text-[var(--muted)]" />
                              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--foreground)]">
                                {survey.pencawang ?? "Unnamed Pencawang"}
                              </span>
                              <Chip tone={survey.amendment ? "critical" : "info"}>
                                {survey.amendment ? "Perlu pindaan" : "Dalam rondaan"}
                              </Chip>
                            </div>
                            <p className="mt-1 text-[12px] text-[var(--muted)]">
                              {survey.poles.toLocaleString()} pole{survey.poles === 1 ? "" : "s"} · started{" "}
                              {formatDate(survey.startedAt)}
                            </p>
                            {survey.amendment ? (
                              <p className="mt-2 flex gap-2 rounded-[8px] bg-[var(--critical-bg)] px-2.5 py-2 text-[12.5px] text-[var(--critical-text)]">
                                <Undo2 size={14} className="mt-0.5 shrink-0" />
                                <span>
                                  <b>To fix:</b> {survey.amendment.remark ?? "see the survey"}
                                  {survey.amendment.at ? ` · ${formatDate(survey.amendment.at)}` : ""}
                                </span>
                              </p>
                            ) : null}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[13px] text-[var(--muted)]">No open surveys for your team.</p>
                  )}
                </Card>

                {data.teams.map((team) => (
                  <Card key={team.id}>
                    <CardHead
                      title={team.name}
                      hint={[team.company, team.supervisors.length ? `Supervisor: ${team.supervisors.join(", ")}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                    <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                      {team.members.map((member) => (
                        <li key={member.id} className="flex items-center gap-2 text-[13px] text-[var(--foreground-soft)]">
                          <Users size={14} className="shrink-0 text-[var(--muted)]" />
                          <span className="min-w-0 truncate">{member.name}</span>
                          {member.isMe ? <Chip tone="brand">You</Chip> : null}
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>
            )
          ) : isLoading ? (
            <Card className="mt-6 px-5 py-12 text-center text-[13px] text-[var(--muted)]">Loading…</Card>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}

export function MyTeamClient() {
  return (
    <AuthGuard>
      <MyTeamContent />
    </AuthGuard>
  );
}
