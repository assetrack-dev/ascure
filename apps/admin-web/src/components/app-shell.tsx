"use client";

import { BarChart3, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import type { AuthUser } from "@/types/auth";
import { roleLabel } from "@/lib/roles";

interface AppShellProps {
  children: React.ReactNode;
  user: AuthUser | null;
  onLogout: () => void;
}

export function AppShell({ children, user, onLogout }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="border-b border-[var(--line)] bg-[#111827] text-white lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-5 py-4 lg:block lg:px-6 lg:py-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0f766e] font-bold">
                A
              </div>
              <div>
                <p className="text-lg font-bold tracking-wide">ASCURE</p>
                <p className="text-xs text-slate-300">Admin Console</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/15 text-slate-200 transition hover:bg-white/10 lg:hidden"
            aria-label="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>

        <nav className="flex gap-2 overflow-x-auto px-5 pb-4 lg:block lg:px-4">
          <a
            href="/dashboard"
            className="flex min-w-fit items-center gap-3 rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-white"
          >
            <LayoutDashboard size={18} />
            Dashboard
          </a>
          <div className="flex min-w-fit items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-300 lg:mt-1">
            <BarChart3 size={18} />
            Analytics
          </div>
        </nav>

        <div className="hidden px-6 pb-6 lg:mt-auto lg:block">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
              <ShieldCheck size={16} />
              {roleLabel(user?.role)}
            </div>
            <p className="mt-3 truncate text-sm font-semibold">{user?.name ?? "ASCURE User"}</p>
            <p className="mt-1 truncate text-xs text-slate-300">{user?.email ?? "Signed in"}</p>
            <button
              type="button"
              onClick={onLogout}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
