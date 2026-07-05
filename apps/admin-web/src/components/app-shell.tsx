"use client";

import {
  Archive,
  BarChart3,
  Bug,
  Building2,
  CalendarClock,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  Layers2,
  LogOut,
  Map as MapIcon,
  MapPinned,
  Network,
  PackageCheck,
  ShieldCheck,
  Tags,
  Upload,
  Users,
  Waypoints,
  Wrench,
  ChevronDown,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import type { AuthUser } from "@/types/auth";
import { roleLabel } from "@/lib/roles";
import { ThemeToggle } from "./theme-toggle";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** When set, only these roles see the item (data is still server-scoped). */
  roles?: string[];
  requiresReporting?: boolean;
  requiresImport?: boolean;
  requiresManageUsers?: boolean;
  /** Gated to QA governors (canGovernQa) + ADMIN — e.g. the defect Operations Board. */
  requiresGovernQa?: boolean;
  /** Admin config surface — collapsed under the "Setup" group in the sidebar. */
  group?: "setup";
  /** Kept in code but removed from the nav (pending deletion). */
  hidden?: boolean;
};

interface AppShellProps {
  children: React.ReactNode;
  user: AuthUser | null;
  onLogout: () => void;
}

// A MANAGER runs their own company: an explicit, closed nav allow-list of the
// operational surfaces they own (every tab's data is company-scoped server-side).
// This intentionally overrides the per-item adminOnly/capability gates — it both
// reveals Teams (otherwise adminOnly) and hides everything not in the list
// (Network, the Operations Board QA surface, the org/region/asset-type admin
// tools). Reports is the one exception — added back in the filter when canReport.
const MANAGER_NAV_HREFS = new Set<string>([
  "/dashboard",
  "/maintenance-workspace",
  "/assets",
  "/map",
  "/site-visits",
  "/defects",
  "/crew-performance",
  "/users",
  "/teams",
]);

export function AppShell({ children, user, onLogout }: AppShellProps) {
  const pathname = usePathname();
  const navItems: NavItem[] = [
    // Operations — daily-use surfaces (top of the sidebar).
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/site-visits", label: "Site Visits", icon: MapPinned },
    { href: "/assets", label: "Assets", icon: Archive },
    {
      href: "/map",
      label: "Map",
      icon: MapIcon,
      roles: ["ADMIN", "MANAGER", "SUPERVISOR"],
    },
    { href: "/defects", label: "Defects", icon: Bug },
    {
      href: "/operations-board",
      label: "Operations Board",
      icon: ClipboardList,
      requiresGovernQa: true,
    },
    {
      href: "/maintenance-workspace",
      label: "Maintenance",
      icon: Wrench,
      roles: ["ADMIN", "MANAGER", "SUPERVISOR"],
    },
    { href: "/network", label: "Network", icon: Waypoints },
    {
      href: "/crew-performance",
      label: "Crew Performance",
      icon: BarChart3,
      roles: ["ADMIN", "MANAGER"],
    },
    // Reporting + people.
    {
      href: "/reports",
      label: "Reports",
      icon: FileSpreadsheet,
      requiresReporting: true,
    },
    { href: "/users", label: "Users", icon: Users, requiresManageUsers: true },
    // Setup — admin config, collapsed under a "Setup" group in the sidebar.
    { href: "/organizations", label: "Organizations", icon: Building2, adminOnly: true, group: "setup" },
    { href: "/operational-regions", label: "Regions", icon: MapPinned, adminOnly: true, group: "setup" },
    { href: "/mainheads", label: "Mainheads", icon: Network, adminOnly: true, group: "setup" },
    { href: "/teams", label: "Teams", icon: Users, adminOnly: true, group: "setup" },
    { href: "/projects", label: "Projects", icon: FolderKanban, adminOnly: true, group: "setup" },
    { href: "/asset-types", label: "Asset Types", icon: Layers2, adminOnly: true, group: "setup" },
    { href: "/pencawang", label: "Pencawang", icon: Factory, adminOnly: true, group: "setup" },
    { href: "/capabilities", label: "Capabilities", icon: Tags, adminOnly: true, group: "setup" },
    { href: "/checklist-templates", label: "Checklists", icon: ClipboardList, adminOnly: true, group: "setup" },
    { href: "/report-templates", label: "Report Templates", icon: FileText, adminOnly: true, group: "setup" },
    { href: "/imports", label: "Imports", icon: Upload, requiresImport: true, group: "setup" },
    // Hidden from nav (kept in code, pending deletion) — declutter pass 2026-07-06.
    { href: "/branches", label: "Branches", icon: GitBranch, adminOnly: true, group: "setup", hidden: true },
    { href: "/work-packages", label: "Work Packages", icon: PackageCheck, adminOnly: true, group: "setup", hidden: true },
    { href: "/operational-sessions", label: "Operations / Sessions", icon: CalendarClock, adminOnly: true, hidden: true },
  ];
  // The raw backend role: the admin web collapses MANAGER/SUPERVISOR/TECHNICIAN
  // to VIEWER via normalizeRole, so user.role alone would mis-gate them.
  // sourceRole is undefined for ADMIN/VIEWER/CLIENT, so the user.role fallback
  // still holds for those.
  const effectiveRole = user?.sourceRole ?? user?.role ?? "";
  // Title-case the REAL backend role for the footer badge (roleLabel would
  // collapse MANAGER back to "Viewer", which is misleading now that managers get
  // an elevated nav + team-management powers).
  const effectiveRoleLabel = effectiveRole
    ? effectiveRole.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
    : roleLabel(user?.role);

  const visibleNavItems = navItems.filter((item) => {
    // Hidden pages stay in code but never appear in the nav.
    if (item.hidden) {
      return false;
    }

    // MANAGER: closed allow-list (see MANAGER_NAV_HREFS) — overrides every other
    // gate so a manager sees exactly their company's operational surfaces. Reports
    // is the one capability-gated exception layered on top of the list.
    if (effectiveRole === "MANAGER") {
      if (item.href === "/reports") {
        return user?.canReport === true;
      }
      return MANAGER_NAV_HREFS.has(item.href);
    }

    if (item.adminOnly && user?.role !== "ADMIN") {
      return false;
    }

    if (item.roles && !item.roles.includes(effectiveRole)) {
      return false;
    }

    // The defect Operations Board is a QA-governance surface — only QA governors
    // (canGovernQa) and ADMIN. Contractors don't triage QA.
    if (
      item.requiresGovernQa &&
      user?.canGovernQa !== true &&
      user?.role !== "ADMIN"
    ) {
      return false;
    }

    if (item.requiresReporting && user?.canReport !== true && user?.role !== "ADMIN") {
      return false;
    }

    if (item.requiresImport && user?.canImport !== true && user?.role !== "ADMIN") {
      return false;
    }

    if (
      item.requiresManageUsers &&
      user?.canManageUsers !== true &&
      user?.role !== "ADMIN"
    ) {
      return false;
    }

    return true;
  });

  // The collapsible "Setup" group is an ADMIN-only convenience: every setup item
  // is adminOnly, and a MANAGER's handful of config surfaces (Teams) read better
  // flat. Non-admins render everything flat.
  const isAdmin = user?.role === "ADMIN";
  const setupItems = visibleNavItems.filter((item) => item.group === "setup");
  const useSetupGroup = isAdmin && setupItems.length > 0;
  const topNavItems = useSetupGroup
    ? visibleNavItems.filter((item) => item.group !== "setup")
    : visibleNavItems;
  const onSetupPage = setupItems.some(
    (item) => pathname === item.href || pathname?.startsWith(`${item.href}/`),
  );
  const [setupOpen, setSetupOpen] = useState(onSetupPage);

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive =
      pathname === item.href || pathname?.startsWith(`${item.href}/`);

    return (
      <a
        key={item.href}
        href={item.href}
        className={`flex h-10 min-w-fit items-center gap-3 rounded-md px-3 text-sm transition lg:mt-1 ${
          isActive
            ? "bg-[var(--chrome-active)] font-semibold text-[var(--chrome-accent)] shadow-[inset_3px_0_0_var(--chrome-accent)]"
            : "font-medium text-[var(--on-chrome-muted)] hover:bg-[var(--chrome-active)] hover:text-[var(--on-chrome)]"
        }`}
      >
        <Icon size={18} />
        {item.label}
      </a>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] lg:grid lg:grid-cols-[272px_1fr]">
      <aside className="border-b border-[var(--chrome-line)] bg-[var(--chrome)] text-[var(--on-chrome)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-5 py-4 lg:block lg:px-6 lg:py-7">
          <div>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/monogram.png"
                alt="ASCURE"
                width={44}
                height={44}
                className="h-11 w-11 rounded-xl shadow-sm"
              />
              <div>
                <p className="text-lg font-bold tracking-wide" style={{ fontFamily: "var(--font-display)" }}>ASCURE</p>
                <p className="text-xs font-medium text-[var(--on-chrome-muted)]">Admin Console</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--chrome-line-strong)] text-[var(--on-chrome)] transition hover:bg-[var(--chrome-active)] lg:hidden"
            aria-label="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>

        <nav className="flex gap-2 overflow-x-auto px-5 pb-4 lg:block lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto lg:px-4">
          {topNavItems.map((item) => renderNavItem(item))}

          {useSetupGroup ? (
            <div className="lg:mt-3">
              <button
                type="button"
                onClick={() => setSetupOpen((open) => !open)}
                aria-expanded={setupOpen}
                className="flex h-10 w-full min-w-fit items-center gap-3 rounded-md px-3 text-sm font-semibold text-[var(--on-chrome-muted)] transition hover:bg-[var(--chrome-active)] hover:text-[var(--on-chrome)]"
              >
                <Settings2 size={18} />
                <span className="flex-1 text-left">Setup</span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${setupOpen ? "rotate-180" : ""}`}
                />
              </button>
              {setupOpen ? setupItems.map((item) => renderNavItem(item)) : null}
            </div>
          ) : null}
        </nav>

        <div className="hidden px-6 pb-6 lg:mt-auto lg:block">
          <div className="rounded-xl border border-[var(--chrome-line)] bg-[var(--chrome-active)] p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--on-chrome-muted)]">
              <ShieldCheck size={16} />
              {effectiveRoleLabel}
            </div>
            <p className="mt-3 truncate text-sm font-semibold">{user?.name ?? "ASCURE User"}</p>
            <p className="mt-1 truncate text-xs text-[var(--on-chrome-muted)]">{user?.email ?? "Signed in"}</p>
            {user?.organizationName ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--chrome-line)] bg-[var(--chrome-active)] px-2.5 py-1.5 text-xs font-semibold text-[var(--on-chrome)]">
                <Building2 size={14} className="shrink-0 text-[var(--on-chrome-muted)]" />
                <span className="truncate" title={user.organizationName}>
                  {user.organizationName}
                </span>
              </div>
            ) : null}
            <div className="mt-4">
              <ThemeToggle />
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--chrome-line-strong)] px-3 text-sm font-semibold text-[var(--on-chrome)] transition hover:bg-[var(--chrome-active)]"
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
