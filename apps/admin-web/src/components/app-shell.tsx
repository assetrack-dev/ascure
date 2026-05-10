"use client";

import {
  Archive,
  BarChart3,
  Bug,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type { AuthUser } from "@/types/auth";
import { roleLabel } from "@/lib/roles";

interface AppShellProps {
  children: React.ReactNode;
  user: AuthUser | null;
  onLogout: () => void;
}

export function AppShell({ children, user, onLogout }: AppShellProps) {
  const pathname = usePathname();
  const navItems = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      href: "/assets",
      label: "Assets",
      icon: Archive,
    },
    {
      href: "/defects",
      label: "Defects",
      icon: Bug,
    },
    {
      href: "/users",
      label: "Users",
      icon: Users,
      adminOnly: true,
    },
  ];
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user?.role === "ADMIN");

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] lg:grid lg:grid-cols-[272px_1fr]">
      <aside className="border-b border-slate-800 bg-slate-950 text-white lg:sticky lg:top-0 lg:flex lg:min-h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-5 py-4 lg:block lg:px-6 lg:py-7">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--brand)] text-base font-bold shadow-sm">
                A
              </div>
              <div>
                <p className="text-lg font-bold">ASCURE</p>
                <p className="text-xs font-medium text-slate-300">Admin Console</p>
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
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname?.startsWith(`${item.href}/`);

            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex h-10 min-w-fit items-center gap-3 rounded-md px-3 text-sm transition lg:mt-1 ${
                  isActive
                    ? "bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_var(--brand)]"
                    : "font-medium text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </a>
            );
          })}
          <div className="flex h-10 min-w-fit items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-500 lg:mt-1">
            <BarChart3 size={18} />
            Analytics
          </div>
        </nav>

        <div className="hidden px-6 pb-6 lg:mt-auto lg:block">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-300">
              <ShieldCheck size={16} />
              {roleLabel(user?.role)}
            </div>
            <p className="mt-3 truncate text-sm font-semibold">{user?.name ?? "ASCURE User"}</p>
            <p className="mt-1 truncate text-xs text-slate-300">{user?.email ?? "Signed in"}</p>
            <button
              type="button"
              onClick={onLogout}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/15 px-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
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
