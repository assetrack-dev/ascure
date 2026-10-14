"use client";

import { Bell, BellOff, BellRing, CheckCheck, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readStoredSession } from "@/lib/auth";
import {
  type AppNotification,
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";
import { disablePush, enablePush, type PushState, readPushState } from "@/lib/push";

/** How often the unread count refreshes while the console is open. */
const POLL_MS = 60_000;

function timeAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

const PUSH_COPY: Record<PushState, string> = {
  on: "Phone notifications are on for this device.",
  off: "Get these on your phone, even when the console is closed.",
  blocked: "Notifications are blocked for this site — allow them in the browser's site settings.",
  "needs-install":
    "On iPhone: tap Share → Add to Home Screen, open ASCURE from that icon, then turn this on.",
  "server-off": "Phone notifications are not set up on the server yet.",
  unsupported: "This browser can't show phone notifications.",
};

/**
 * The console 🔔 (plan §19, N56): unread count, the latest notifications, and
 * the per-device switch for phone (Web Push) notifications. `variant` matches
 * where it sits — the dark phone top bar or the light desktop rail.
 */
export function NotificationBell({ variant }: { variant: "chrome" | "rail" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const token = () => readStoredSession()?.token ?? null;

  const refreshCount = useCallback(async () => {
    const t = token();
    if (!t) return;
    try {
      setUnread((await fetchUnreadCount(t)).unread);
    } catch {
      // Offline / signed out — keep the last count; the page handles 401s.
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = window.setInterval(() => void refreshCount(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCount]);

  const loadPanel = useCallback(async () => {
    const t = token();
    if (!t) return;
    try {
      const list = await fetchNotifications(t);
      setItems(list.items);
      setUnread(list.unread);
    } catch {
      setItems((current) => current ?? []);
    }
    setPush(await readPushState(t).catch(() => "unsupported" as PushState));
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadPanel();
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, loadPanel]);

  const openItem = async (item: AppNotification) => {
    const t = token();
    setOpen(false);
    if (t && !item.readAt) {
      try {
        setUnread((await markNotificationRead(t, item.id)).unread);
      } catch {
        // Opening the link matters more than the read mark.
      }
    }
    router.push(item.url);
  };

  const readAll = async () => {
    const t = token();
    if (!t) return;
    await markAllNotificationsRead(t).catch(() => undefined);
    setUnread(0);
    setItems((current) => current?.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) ?? null);
  };

  const togglePush = async () => {
    const t = token();
    if (!t || busy) return;
    setBusy(true);
    try {
      setPush(push === "on" ? await disablePush(t) : await enablePush(t));
    } catch {
      setPush(await readPushState(t).catch(() => "unsupported" as PushState));
    } finally {
      setBusy(false);
    }
  };

  const buttonClass =
    variant === "chrome"
      ? "border border-[var(--chrome-line-strong)] text-[var(--on-chrome)] hover:bg-[var(--chrome-panel)]"
      : "border border-[var(--line)] text-[var(--foreground)] hover:bg-[var(--panel-muted)]";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`relative inline-flex h-10 w-10 items-center justify-center rounded-[9px] transition ${buttonClass}`}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        {unread > 0 ? <BellRing size={18} /> : <Bell size={18} />}
        {unread > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-center text-[10.5px] font-bold leading-none text-white shadow">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-3 top-[76px] z-50 flex max-h-[min(560px,calc(100vh-96px))] flex-col overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--panel)] text-[var(--foreground)] shadow-[var(--shadow-card)] sm:left-auto sm:right-4 sm:w-[380px] lg:top-[60px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
            <p className="text-[14px] font-bold">Notifications</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void readAll()}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[12px] font-semibold text-[var(--brand)] hover:bg-[var(--panel-muted)]"
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-[13px] text-[var(--muted)]">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-[var(--muted)]">
                Nothing yet. You&apos;ll be told here when crews submit repairs for your verification.
              </p>
            ) : (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      className={`flex w-full gap-3 border-b border-[var(--line)] px-4 py-3 text-left transition hover:bg-[var(--panel-muted)] ${item.readAt ? "" : "bg-[var(--brand-tint)]"}`}
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-transparent" : "bg-[var(--brand)]"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold leading-snug">{item.title}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--foreground-soft)]">
                          {item.body}
                        </span>
                        <span className="mt-1 block text-[11.5px] text-[var(--muted)]">{timeAgo(item.lastEventAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {push ? (
            <div className="flex items-start gap-3 border-t border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3">
              <Smartphone size={18} className="mt-0.5 shrink-0 text-[var(--muted)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-snug text-[var(--foreground-soft)]">{PUSH_COPY[push]}</p>
                {push === "on" || push === "off" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void togglePush()}
                    className={`mt-2 inline-flex h-9 items-center gap-2 rounded-[9px] px-3 text-[12.5px] font-semibold transition disabled:opacity-60 ${
                      push === "on"
                        ? "border border-[var(--line-strong)] text-[var(--foreground)] hover:bg-[var(--panel)]"
                        : "bg-[var(--brand)] text-[var(--on-brand)] hover:bg-[var(--brand-strong)]"
                    }`}
                  >
                    {push === "on" ? <BellOff size={15} /> : <BellRing size={15} />}
                    {busy ? "Please wait…" : push === "on" ? "Turn off on this device" : "Turn on phone notifications"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
