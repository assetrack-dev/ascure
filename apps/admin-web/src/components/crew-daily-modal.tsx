"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

import { ApiError } from "@/lib/api";
import {
  fetchCrewPerformanceDaily,
  type CrewPerformanceDaily,
} from "@/lib/reports";
import { filterSelectClass } from "@/components/ui";

/**
 * The leaderboard row drill-down: one crew member's day-by-day output for a
 * month, as a bar per calendar day. A day with no bar is a day with no
 * submitted inspections — that gap IS the attendance view. Click a bar (or an
 * empty day) to pin that date's exact numbers; step months with ‹ › or the
 * month picker, independently of the page's selected month.
 */

function monthRange(month: string): { from: string; to: string } {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function shiftMonth(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split("-");
  const date = new Date(Number(yearStr), Number(monthStr) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Today's date key in MYT (UTC+8) — the same day boundary the API buckets by. */
function todayKeyMYT(): string {
  return new Date(Date.now() + 480 * 60_000).toISOString().slice(0, 10);
}

function formatDayLong(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return new Intl.DateTimeFormat("en-MY", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

interface DaySlot {
  date: string;
  dayOfMonth: number;
  isSunday: boolean;
  assets: number;
  inspections: number;
  visits: number;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">
        {label}
      </p>
      <p
        className="mt-0.5 font-mono text-[16px] font-bold tabular-nums text-[var(--foreground)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

export function CrewDailyModal({
  token,
  userId,
  userName,
  initialMonth,
  onClose,
  onUnauthorized,
}: {
  token: string;
  userId: string;
  userName: string;
  initialMonth: string;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<CrewPerformanceDaily | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(
    async (selectedMonth: string) => {
      setIsLoading(true);
      setError("");
      const { from, to } = monthRange(selectedMonth);
      try {
        setData(await fetchCrewPerformanceDaily(token, userId, from, to));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          onUnauthorized();
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load the daily numbers.",
        );
        setData(null);
      } finally {
        setIsLoading(false);
      }
    },
    [token, userId, onUnauthorized],
  );

  useEffect(() => {
    setSelectedDate(null);
    void load(month);
  }, [month, load]);

  // Escape closes, like the photo lightbox.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Every calendar day of the month, zero-filled — gaps must be VISIBLE.
  const slots = useMemo<DaySlot[]>(() => {
    const byDate = new Map((data?.days ?? []).map((day) => [day.date, day]));
    const [yearStr, monthStr] = month.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const result: DaySlot[] = [];
    for (let day = 1; day <= lastDay; day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const row = byDate.get(date);
      result.push({
        date,
        dayOfMonth: day,
        isSunday: new Date(year, monthIndex, day).getDay() === 0,
        assets: row?.assets ?? 0,
        inspections: row?.inspections ?? 0,
        visits: row?.visits ?? 0,
      });
    }
    return result;
  }, [data, month]);

  const maxAssets = useMemo(
    () => Math.max(...slots.map((slot) => slot.assets), 0),
    [slots],
  );

  // Absent = elapsed days of the month with no output (future days aren't
  // absences; for past months every day has elapsed).
  const absentDays = useMemo(() => {
    const today = todayKeyMYT();
    return slots.filter((slot) => slot.date <= today && slot.assets === 0).length;
  }, [slots]);

  const selected = selectedDate
    ? (slots.find((slot) => slot.date === selectedDate) ?? null)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">
              Daily output
            </p>
            <h2 className="mt-0.5 truncate text-[16px] font-bold text-[var(--foreground)]">
              {data?.name ?? userName}
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">
              {[data?.role, data?.companyName, data?.teamName]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--panel-muted)] hover:text-[var(--foreground)]"
          >
            <X size={17} />
          </button>
        </div>

        {/* Month nav + summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line2)] px-5 py-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth((value) => shiftMonth(value, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)] text-[var(--foreground-soft)] transition hover:bg-[var(--panel-muted)]"
            >
              <ChevronLeft size={15} />
            </button>
            <input
              type="month"
              aria-label="Month"
              value={month}
              onChange={(event) => {
                if (event.target.value) {
                  setMonth(event.target.value);
                }
              }}
              className={filterSelectClass}
            />
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonth((value) => shiftMonth(value, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)] text-[var(--foreground-soft)] transition hover:bg-[var(--panel-muted)]"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="flex items-center gap-5">
            <Stat label="Assets" value={data?.totalAssets ?? 0} />
            <Stat label="Insp." value={data?.totalInspections ?? 0} />
            <Stat label="Active days" value={data?.activeDays ?? 0} />
            <Stat label="Absent" value={absentDays} />
          </div>
        </div>

        {/* Chart */}
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex h-[220px] items-center justify-center text-[13px] text-[var(--muted)]">
              Loading…
            </div>
          ) : error ? (
            <div className="rounded-[9px] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-4 py-3 text-[13px] font-semibold text-[var(--critical-text)]">
              {error}
            </div>
          ) : (
            <>
              <div className="flex items-stretch gap-[3px]" style={{ height: 180 }}>
                {slots.map((slot) => {
                  const height =
                    maxAssets > 0 && slot.assets > 0
                      ? Math.max((slot.assets / maxAssets) * 160, 4)
                      : 0;
                  const isSelected = selectedDate === slot.date;
                  return (
                    <button
                      type="button"
                      key={slot.date}
                      onClick={() =>
                        setSelectedDate((current) =>
                          current === slot.date ? null : slot.date,
                        )
                      }
                      title={`${formatDayLong(slot.date)} — ${slot.assets} assets`}
                      className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1 outline-none"
                    >
                      {slot.assets > 0 ? (
                        <span className="mb-0.5 hidden font-mono text-[9px] tabular-nums text-[var(--muted)] group-hover:block lg:block">
                          {slot.assets}
                        </span>
                      ) : null}
                      <span
                        className={`w-full rounded-t-[3px] transition ${
                          slot.assets > 0
                            ? isSelected
                              ? "bg-[var(--brand-strong)]"
                              : "bg-[var(--brand)] group-hover:bg-[var(--brand-strong)]"
                            : isSelected
                              ? "bg-[var(--muted-2)]"
                              : "bg-[var(--panel-muted)]"
                        }`}
                        style={{ height: slot.assets > 0 ? height : 3 }}
                      />
                      <span
                        className={`font-mono text-[9px] tabular-nums ${
                          isSelected
                            ? "font-bold text-[var(--foreground)]"
                            : slot.isSunday
                              ? "text-[var(--critical-text)] opacity-70"
                              : "text-[var(--muted-2)]"
                        }`}
                      >
                        {slot.dayOfMonth}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Selected-day detail — the "check one specific date" answer. */}
              <div className="mt-3 flex min-h-[38px] items-center gap-2 rounded-[9px] border border-[var(--line2)] bg-[var(--panel-muted)] px-3.5 py-2 text-[12.5px]">
                <CalendarDays size={14} className="shrink-0 text-[var(--muted-2)]" />
                {selected ? (
                  <span className="text-[var(--foreground-soft)]">
                    <span className="font-semibold text-[var(--foreground)]">
                      {formatDayLong(selected.date)}
                    </span>
                    {selected.assets > 0 ? (
                      <>
                        {" — "}
                        <span className="font-mono font-bold tabular-nums text-[var(--foreground)]">
                          {selected.assets}
                        </span>{" "}
                        assets ·{" "}
                        <span className="font-mono tabular-nums">
                          {selected.inspections}
                        </span>{" "}
                        inspections ·{" "}
                        <span className="font-mono tabular-nums">{selected.visits}</span>{" "}
                        {selected.visits === 1 ? "visit" : "visits"}
                      </>
                    ) : (
                      <> — no inspections submitted (absent)</>
                    )}
                  </span>
                ) : (
                  <span className="text-[var(--muted)]">
                    Click a day to see its exact numbers. A day with no bar has no
                    submitted inspections.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
