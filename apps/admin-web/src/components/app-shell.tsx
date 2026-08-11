"use client";

import {
  Archive,
  BarChart3,
  Bug,
  Building2,
  CalendarClock,
  ClipboardCheck,
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
  TrendingUp,
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

/** Sidebar grouping. Purely presentational — gating is unchanged. */
type NavSection = "operations" | "insights" | "admin";

const SECTION_ORDER: NavSection[] = ["operations", "insights", "admin"];
const SECTION_LABELS: Record<NavSection, string> = {
  operations: "Operations",
  insights: "Insights",
  admin: "Admin",
};

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSection;
  adminOnly?: boolean;
  /** When set, only these roles see the item (data is still server-scoped). */
  roles?: string[];
  requiresReporting?: boolean;
  requiresImport?: boolean;
  requiresManageUsers?: boolean;
  /** Only a CLIENT-org viewer (or ADMIN, previewing) sees this. */
  requiresClientViewer?: boolean;
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
  // Edit-only surface for a manager: fix a Pencawang's details/map pin (their
  // own company's only — server-enforced). Delete/deactivate/Mainhead stay
  // ADMIN-only and are hidden on the page itself.
  "/pencawang",
]);

// A CLIENT viewer (TNB) sees exactly three pages: their progress roll-up, the
// survey feed and the asset map — all server-scoped to the Mainheads assigned to
// their organization, all read-only. Everything else here is contractor
// operations, not theirs. ⚠ Keep /site-visits OUT: that page is the contractor's
// operational surface (lifecycle actions, editable checklist cells); the client
// gets /visits, a purpose-built read-only feed over the same surveys.
// ⚠ This allow-list also OVERRIDES the /map item's own `roles` gate (which lists
// only ADMIN/MANAGER/SUPERVISOR), so the client branch must run before it.
const CLIENT_NAV_HREFS = new Set<string>(["/progress", "/visits", "/map"]);

export function AppShell({ children, user, onLogout }: AppShellProps) {
  const pathname = usePathname();
  const navItems: NavItem[] = [
    // Operations — daily-use surfaces (top of the sidebar).
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "operations" },
    { href: "/site-visits", label: "Site Visits", icon: MapPinned, section: "operations" },
    { href: "/assets", label: "Assets", icon: Archive, section: "operations" },
    {
      href: "/map",
      label: "Map",
      icon: MapIcon,
      section: "operations",
      roles: ["ADMIN", "MANAGER", "SUPERVISOR"],
    },
    { href: "/defects", label: "Defects", icon: Bug, section: "operations" },
    {
      href: "/operations-board",
      label: "Operations Board",
      icon: ClipboardList,
      section: "operations",
      requiresGovernQa: true,
      // Hidden from the nav for now (owner: not needed right now). Route + code
      // kept; breadcrumbs still resolve if reached directly.
      hidden: true,
    },
    {
      href: "/maintenance-workspace",
      label: "Maintenance",
      icon: Wrench,
      section: "operations",
      roles: ["ADMIN", "MANAGER", "SUPERVISOR"],
    },
    { href: "/network", label: "Network", icon: Waypoints, section: "operations" },
    // The network owner's (TNB / CLIENT) read-only view. Gated to client orgs +
    // ADMIN (who can preview it); CLIENT_NAV_HREFS makes it their ONLY page.
    {
      href: "/progress",
      label: "Progress",
      icon: TrendingUp,
      section: "operations",
      requiresClientViewer: true,
    },
    // The client's survey feed — every survey on their Mainheads at every
    // lifecycle stage, read-only. Distinct from /site-visits (the contractor's
    // operational surface); see CLIENT_NAV_HREFS.
    {
      href: "/visits",
      label: "Surveys",
      icon: ClipboardCheck,
      section: "operations",
      requiresClientViewer: true,
    },
    // Insights — reporting + analytics.
    {
      href: "/crew-performance",
      label: "Crew Performance",
      icon: BarChart3,
      section: "insights",
      roles: ["ADMIN", "MANAGER"],
    },
    {
      href: "/reports",
      label: "Reports",
      icon: FileSpreadsheet,
      section: "insights",
      requiresReporting: true,
    },
    // Admin — people, then the collapsed Setup config group.
    { href: "/users", label: "Users", icon: Users, section: "admin", requiresManageUsers: true },
    { href: "/organizations", label: "Organizations", icon: Building2, section: "admin", adminOnly: true, group: "setup" },
    { href: "/operational-regions", label: "Regions", icon: MapPinned, section: "admin", adminOnly: true, group: "setup" },
    { href: "/mainheads", label: "Mainheads", icon: Network, section: "admin", adminOnly: true, group: "setup" },
    { href: "/teams", label: "Teams", icon: Users, section: "admin", adminOnly: true, group: "setup" },
    { href: "/projects", label: "Projects", icon: FolderKanban, section: "admin", adminOnly: true, group: "setup" },
    { href: "/asset-types", label: "Asset Types", icon: Layers2, section: "admin", adminOnly: true, group: "setup" },
    { href: "/pencawang", label: "Pencawang", icon: Factory, section: "admin", adminOnly: true, group: "setup" },
    { href: "/capabilities", label: "Capabilities", icon: Tags, section: "admin", adminOnly: true, group: "setup" },
    { href: "/checklist-templates", label: "Checklists", icon: ClipboardList, section: "admin", adminOnly: true, group: "setup" },
    { href: "/report-templates", label: "Report Templates", icon: FileText, section: "admin", adminOnly: true, group: "setup" },
    { href: "/imports", label: "Imports", icon: Upload, section: "admin", requiresImport: true, group: "setup" },
    // Hidden from nav (kept in code, pending deletion) — declutter pass 2026-07-06.
    { href: "/branches", label: "Branches", icon: GitBranch, section: "admin", adminOnly: true, group: "setup", hidden: true },
    { href: "/work-packages", label: "Work Packages", icon: PackageCheck, section: "admin", adminOnly: true, group: "setup", hidden: true },
    { href: "/operational-sessions", label: "Operations / Sessions", icon: CalendarClock, section: "operations", adminOnly: true, hidden: true },
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

    // CLIENT VIEWER (TNB): closed allow-list — the progress view only.
    if (user?.isClientViewer === true && user?.role !== "ADMIN") {
      return CLIENT_NAV_HREFS.has(item.href);
    }

    // The Progress view itself is only offered to a client org (or ADMIN, to
    // preview what the client sees).
    if (
      item.requiresClientViewer &&
      user?.isClientViewer !== true &&
      user?.role !== "ADMIN"
    ) {
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

  const isItemActive = (item: NavItem) =>
    pathname === item.href || pathname?.startsWith(`${item.href}/`);

  // Breadcrumb source. Matched against every item — including hidden ones and
  // detail routes like /assets/[id] — so drill-throughs still name their section.
  // Longest href wins, so /operational-regions never loses to a shorter prefix.
  const activeItem = navItems
    .filter((item) => isItemActive(item))
    .sort((a, b) => b.href.length - a.href.length)[0];

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isItemActive(item);

    return (
      <a
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={`flex h-[38px] min-w-fit items-center gap-[11px] rounded-[9px] px-[11px] text-[13.5px] transition lg:mt-0.5 ${
          isActive
            ? "bg-[var(--brand-tint)] font-semibold text-[var(--brand-strong)] shadow-[inset_3px_0_0_var(--brand)]"
            : "font-medium text-[var(--on-chrome-muted)] hover:bg-[var(--chrome-panel)] hover:text-[var(--on-chrome)]"
        }`}
      >
        <Icon size={18} className="shrink-0" />
        {item.label}
      </a>
    );
  };

  const renderSection = (section: NavSection) => {
    const items = topNavItems.filter((item) => item.section === section);
    const showSetupHere = useSetupGroup && section === "admin";

    if (items.length === 0 && !showSetupHere) {
      return null;
    }

    return (
      <div key={section} className="contents lg:block">
        <p
          className="hidden px-2.5 pb-1.5 pt-3.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--on-chrome-faint)] lg:block"
        >
          {SECTION_LABELS[section]}
        </p>
        {items.map((item) => renderNavItem(item))}

        {showSetupHere ? (
          <div className="lg:mt-0.5">
            <button
              type="button"
              onClick={() => setSetupOpen((open) => !open)}
              aria-expanded={setupOpen}
              className="flex h-[38px] w-full min-w-fit items-center gap-[11px] rounded-[9px] px-[11px] text-[13.5px] font-medium text-[var(--on-chrome-muted)] transition hover:bg-[var(--chrome-panel)] hover:text-[var(--on-chrome)]"
            >
              <Settings2 size={18} className="shrink-0" />
              <span className="flex-1 text-left">Setup</span>
              <ChevronDown
                size={16}
                className={`transition-transform ${setupOpen ? "rotate-180" : ""}`}
              />
            </button>
            {setupOpen ? setupItems.map((item) => renderNavItem(item)) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="border-b border-[var(--chrome-line)] bg-[var(--chrome)] text-[var(--on-chrome)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 px-[14px] py-4 lg:block lg:px-[14px] lg:pb-2 lg:pt-[18px]">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/monogram.png"
              alt="ASCURE"
              width={40}
              height={40}
              className="h-10 w-10 rounded-[11px] shadow-sm"
            />
            <div className="min-w-0">
              <p className="text-[16px] font-bold leading-tight" style={{ fontFamily: "var(--font-display)" }}>
                ASCURE
              </p>
              <p className="text-[11px] font-medium text-[var(--on-chrome-muted)]">Admin Console</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[9px] border border-[var(--chrome-line-strong)] text-[var(--on-chrome)] transition hover:bg-[var(--chrome-panel)] lg:hidden"
            aria-label="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>

        <nav className="flex gap-2 overflow-x-auto px-[14px] pb-4 lg:block lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
          {SECTION_ORDER.map((section) => renderSection(section))}
        </nav>

        <div className="hidden px-[14px] pb-[18px] lg:mt-auto lg:block">
          <div className="rounded-[11px] border border-[var(--chrome-line)] bg-[var(--chrome-panel)] p-3.5">
            <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--on-chrome-muted)]">
              <ShieldCheck size={14} />
              {effectiveRoleLabel}
            </div>
            <p className="mt-2.5 truncate text-[13px] font-semibold">{user?.name ?? "ASCURE User"}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-[var(--on-chrome-muted)]">
              {user?.email ?? "Signed in"}
            </p>
            {user?.organizationName ? (
              <div className="mt-2.5 flex items-center gap-2 rounded-[8px] border border-[var(--chrome-line)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--on-chrome)]">
                <Building2 size={13} className="shrink-0 text-[var(--on-chrome-muted)]" />
                <span className="truncate" title={user.organizationName}>
                  {user.organizationName}
                </span>
              </div>
            ) : null}
            <div className="mt-3">
              <ThemeToggle />
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="mt-2 inline-flex h-[38px] w-full items-center justify-center gap-2 rounded-[9px] border border-[var(--chrome-line-strong)] px-3 text-[13px] font-semibold text-[var(--on-chrome)] transition hover:bg-[var(--chrome-active)]"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Translucent 64px rail. Content scrolls under it. The design also puts a
            global search field and a notification bell here — both omitted: the
            codebase has no search endpoint and no notification model. */}
        <div className="sticky top-0 z-30 hidden h-16 shrink-0 items-center border-b border-[var(--line)] bg-[var(--chrome-translucent)] px-[30px] backdrop-blur-[8px] lg:flex">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] font-medium">
            {activeItem ? (
              <>
                <span className="text-[var(--muted)]">{SECTION_LABELS[activeItem.section]}</span>
                <span aria-hidden className="text-[var(--muted-2)]">
                  /
                </span>
                <span className="font-semibold text-[var(--foreground)]">{activeItem.label}</span>
              </>
            ) : (
              <span className="font-semibold text-[var(--foreground)]">ASCURE</span>
            )}
          </nav>
        </div>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
