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
  Hammer,
  Gauge as GaugeIcon,
  LayoutDashboard,
  Layers2,
  ListChecks,
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuthUser, Workspace } from "@/types/auth";

/**
 * Plan §21 — workspaces by role / company. The API decides which workspace a
 * user is in (`user.workspace`); this file turns it into a menu, a home page and
 * the set of pages the user may open (others redirect home, R2). Navigation only:
 * every endpoint keeps its own scope checks.
 *
 * ADMIN and CLASSIC keep today's console exactly (the original nav filter below)
 * and never redirect, so nothing changes for a company until Admin sets its Web
 * view.
 */

export type NavSection =
  | "operations"
  | "insights"
  | "admin"
  | "maintenance"
  | "survey"
  | "company"
  | "myteam";

export const SECTION_LABELS: Record<NavSection, string> = {
  operations: "Operations",
  insights: "Insights",
  admin: "Admin",
  maintenance: "Maintenance",
  survey: "Survey",
  company: "Company",
  myteam: "My team",
};

export type NavItem = {
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
  /** Server flag canViewRepairVerification: ADMIN, TNB, main-contractor managers. */
  requiresRepairVerification?: boolean;
  /** Server flag canViewMaintenancePackages: + any contractor Manager / Supervisor (plan §15). */
  requiresMaintenancePackages?: boolean;
  /** Plan §19 (N55): ADMIN or TNB Foreman / Technician — the TNB Supervisors page. */
  requiresManageClientSupervisors?: boolean;
  /** Admin config surface — collapsed under the "Setup" group in the sidebar. */
  group?: "setup";
  /** Kept in code but removed from the nav (pending deletion). */
  hidden?: boolean;
};

/** The page part of an href ("/crew-performance?tab=maintenance" → "/crew-performance"). */
export function navPath(href: string) {
  return href.split("?")[0];
}

/** Every page of the console, in today's (classic) order. */
export const NAV_ITEMS: NavItem[] = [
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
  // TNB → maintenance company/team hand-off (docs/PLAN-maintenance-flow.md §12).
  // ADMIN, TNB, main-contractor managers (assign within their group) and — plan
  // §15 — any contractor Manager (re-teams its own work) / Supervisor (view only).
  {
    href: "/maintenance-packages",
    label: "Maintenance Packages",
    icon: PackageCheck,
    section: "operations",
    requiresMaintenancePackages: true,
  },
  // Repair sign-off (verify / reject / re-open / cannot-repair). Server flag
  // decides: ADMIN, TNB, and main-contractor managers only.
  {
    href: "/maintenance-verification",
    label: "Repair Verification",
    icon: ClipboardCheck,
    section: "operations",
    requiresRepairVerification: true,
  },
  // Plan §21.2 #3: a maintenance company's home. Classic console: Admin only.
  {
    href: "/maintenance-overview",
    label: "Overview",
    icon: GaugeIcon,
    section: "operations",
    adminOnly: true,
  },
  // Plan §21 (R5): the field crew's read-only home. Classic console: Admin only.
  {
    href: "/my-team",
    label: "My team",
    icon: Users,
    section: "operations",
    adminOnly: true,
  },
  // Plan §21.2 #1–#2: TNB's day and its contractors' performance. Classic
  // console: Admin (preview) only — TNB has its own workspace.
  {
    href: "/tnb-today",
    label: "Today",
    icon: CalendarClock,
    section: "operations",
    requiresClientViewer: true,
  },
  {
    href: "/tnb-performance",
    label: "Company performance",
    icon: BarChart3,
    section: "insights",
    requiresClientViewer: true,
  },
  // Plan §21.2 #5: repair reports by date. Classic console: Admin only.
  {
    href: "/maintenance-reports",
    label: "Reports",
    icon: FileSpreadsheet,
    section: "insights",
    adminOnly: true,
  },
  // Plan §21.2 #4: where each of the company's Kejanggalan stands. In the
  // classic console only Admin sees it; companies get it in their workspace.
  {
    href: "/maintenance-tasks",
    label: "My tasks",
    icon: ListChecks,
    section: "operations",
    adminOnly: true,
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
  // ADMIN (who can preview it).
  {
    href: "/progress",
    label: "Progress",
    icon: TrendingUp,
    section: "operations",
    requiresClientViewer: true,
  },
  // The client's survey feed — every survey on their Mainheads at every
  // lifecycle stage, read-only. Distinct from /site-visits (the contractor's
  // operational surface).
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
  {
    href: "/tnb-supervisors",
    label: "TNB Supervisors",
    icon: ShieldCheck,
    section: "admin",
    requiresManageClientSupervisors: true,
  },
  { href: "/organizations", label: "Organizations", icon: Building2, section: "admin", adminOnly: true, group: "setup" },
  { href: "/operational-regions", label: "Regions", icon: MapPinned, section: "admin", adminOnly: true, group: "setup" },
  { href: "/mainheads", label: "Mainheads", icon: Network, section: "admin", adminOnly: true, group: "setup" },
  { href: "/teams", label: "Teams", icon: Users, section: "admin", adminOnly: true, group: "setup" },
  { href: "/projects", label: "Projects", icon: FolderKanban, section: "admin", adminOnly: true, group: "setup" },
  { href: "/asset-types", label: "Asset Types", icon: Layers2, section: "admin", adminOnly: true, group: "setup" },
  { href: "/pencawang", label: "Pencawang", icon: Factory, section: "admin", adminOnly: true, group: "setup" },
  { href: "/capabilities", label: "Capabilities", icon: Tags, section: "admin", adminOnly: true, group: "setup" },
  { href: "/checklist-templates", label: "Checklists", icon: ClipboardList, section: "admin", adminOnly: true, group: "setup" },
  { href: "/repair-methods", label: "Repair types", icon: Hammer, section: "admin", adminOnly: true, group: "setup" },
  { href: "/report-templates", label: "Report Templates", icon: FileText, section: "admin", adminOnly: true, group: "setup" },
  { href: "/imports", label: "Imports", icon: Upload, section: "admin", requiresImport: true, group: "setup" },
  // Hidden from nav (kept in code, pending deletion) — declutter pass 2026-07-06.
  { href: "/branches", label: "Branches", icon: GitBranch, section: "admin", adminOnly: true, group: "setup", hidden: true },
  { href: "/work-packages", label: "Work Packages", icon: PackageCheck, section: "admin", adminOnly: true, group: "setup", hidden: true },
  { href: "/operational-sessions", label: "Operations / Sessions", icon: CalendarClock, section: "operations", adminOnly: true, hidden: true },
];

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

// A CLIENT viewer (TNB) in the classic console. Since plan §21 every client
// viewer has the TNB workspace, so this only matters for a session cached before
// the API sent `workspace` — and deriveWorkspace() maps those to TNB too.
// ⚠ Keep /site-visits OUT: that page is the contractor's operational surface;
// the client gets /visits, a purpose-built read-only feed over the same surveys.
const CLIENT_NAV_HREFS = new Set<string>([
  "/progress",
  "/visits",
  "/map",
  "/maintenance-packages",
  "/maintenance-verification",
]);

/** The real backend role (the admin web collapses MANAGER/SUPERVISOR/TECHNICIAN to VIEWER). */
export function effectiveRoleOf(user: AuthUser | null) {
  return user?.sourceRole ?? user?.role ?? "";
}

/** Today's console: the original per-item gates, unchanged. */
function classicNav(user: AuthUser | null): NavItem[] {
  const effectiveRole = effectiveRoleOf(user);

  return NAV_ITEMS.filter((item) => {
    // Hidden pages stay in code but never appear in the nav.
    if (item.hidden) {
      return false;
    }

    // The TNB Supervisors page: ADMIN + TNB Foreman / Technician.
    if (item.requiresManageClientSupervisors) {
      return user?.canManageClientSupervisors === true;
    }

    // CLIENT VIEWER (TNB): closed allow-list.
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
      // Main-contractor managers only (a subcontractor never signs off its own work).
      if (item.requiresRepairVerification) {
        return user?.canViewRepairVerification === true;
      }
      if (item.requiresMaintenancePackages) {
        return user?.canViewMaintenancePackages === true;
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

    if (
      item.requiresRepairVerification &&
      user?.canViewRepairVerification !== true &&
      user?.role !== "ADMIN"
    ) {
      return false;
    }

    if (
      item.requiresMaintenancePackages &&
      user?.canViewMaintenancePackages !== true &&
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
}

function item(href: string, overrides: Partial<NavItem> = {}): NavItem {
  const base = NAV_ITEMS.find((candidate) => candidate.href === navPath(href));
  if (!base) throw new Error(`Unknown nav item ${href}`);
  return { ...base, href, group: undefined, ...overrides };
}

/** Pages that live outside the menu but belong to one of its pages (detail views). */
const DETAIL_PREFIXES = {
  asset: "/assets/",
  defect: "/defects/",
  siteVisit: "/site-visits/",
} as const;

/** Survey-side items: today's console minus the maintenance pages. */
const MAINTENANCE_PATHS = new Set([
  "/maintenance-packages",
  "/maintenance-verification",
  "/maintenance-workspace",
]);

export type CompanyMode = "SURVEY" | "MAINTENANCE";

type Menu = { items: NavItem[]; home: string; detailPrefixes: string[] };

function tnbMenu(user: AuthUser | null, supervisor: boolean): Menu {
  const items = [
    item("/tnb-today", { section: "maintenance" }),
    item("/tnb-performance", { section: "maintenance" }),
    item("/maintenance-verification", { section: "maintenance" }),
    item("/maintenance-packages", { section: "maintenance" }),
    item("/progress", { label: "Survey progress", section: "survey" }),
    item("/visits", { section: "survey" }),
    item("/map", { section: "survey" }),
  ];
  if (user?.canManageClientSupervisors === true) {
    items.push(item("/tnb-supervisors", { section: "admin" }));
  }
  return {
    items,
    // A TNB Supervisor starts on its repair work (owner's call 2026-10-14);
    // everyone else at TNB on Today (plan §21.1).
    home: supervisor ? "/maintenance-packages" : "/tnb-today",
    detailPrefixes: [DETAIL_PREFIXES.asset],
  };
}

function maintenanceCompanyMenu(user: AuthUser | null): Menu {
  const isManager = effectiveRoleOf(user) === "MANAGER";
  const items = [
    item("/maintenance-overview", { section: "maintenance" }),
    item("/maintenance-packages", { label: "Pencawang", section: "maintenance" }),
    item("/maintenance-tasks", { section: "maintenance" }),
    // The Asset Map opens on its Repairs view for a maintenance company.
    item("/map", { section: "maintenance" }),
  ];
  // Main-contractor managers verify their group's repairs; a subcontractor never does.
  if (user?.canViewRepairVerification === true) {
    items.push(item("/maintenance-verification", { section: "maintenance" }));
  }
  // Repair reports: the company's Manager and Supervisor (plan §16 Q7).
  items.push(item("/maintenance-reports", { label: "Repair reports", section: "insights" }));
  if (isManager) {
    items.push(
      item("/crew-performance?tab=maintenance", { label: "Crew performance", section: "insights" }),
      item("/teams", { section: "company" }),
    );
  }
  if (user?.canManageUsers === true) {
    items.push(item("/users", { section: "company" }));
  }
  return {
    items,
    home: "/maintenance-overview",
    detailPrefixes: [DETAIL_PREFIXES.asset, DETAIL_PREFIXES.defect],
  };
}

function surveyCompanyMenu(user: AuthUser | null): Menu {
  return {
    items: classicNav(user).filter((navItem) => !MAINTENANCE_PATHS.has(navItem.href)),
    home: "/dashboard",
    detailPrefixes: [DETAIL_PREFIXES.asset, DETAIL_PREFIXES.defect, DETAIL_PREFIXES.siteVisit],
  };
}

function fieldCrewMenu(user: AuthUser | null): Menu {
  return {
    items: [
      item("/my-team", { section: "myteam" }),
      item("/site-visits", { label: "Surveys", section: "myteam" }),
      // A technician's own team's Kejanggalan (the API refuses a VIEWER).
      ...(effectiveRoleOf(user) === "TECHNICIAN"
        ? [item("/maintenance-tasks", { section: "myteam" })]
        : []),
      item("/map", { section: "myteam" }),
    ],
    home: "/my-team",
    detailPrefixes: [DETAIL_PREFIXES.asset, DETAIL_PREFIXES.defect, DETAIL_PREFIXES.siteVisit],
  };
}

/* ── which workspace ─────────────────────────────────────────────────────── */

/**
 * Mirror of the API's resolveWorkspace (apps/api/src/common/authorization/
 * workspace.ts), used ONLY for a session cached before the API sent `workspace`.
 */
export function deriveWorkspace(user: AuthUser | null): Workspace {
  if (!user) return "CLASSIC";
  if (user.role === "ADMIN") return "ADMIN";
  if (user.isClientViewer) return user.isClientSupervisor ? "TNB_SUPERVISOR" : "TNB";
  if (user.canGovernQa) return "CLASSIC";
  if (!user.workMode) return "CLASSIC";
  const role = effectiveRoleOf(user);
  if (role === "TECHNICIAN" || role === "VIEWER") return "FIELD_CREW";
  if (role === "MANAGER" || role === "SUPERVISOR") {
    if (user.workMode === "SURVEY") return "COMPANY_SURVEY";
    if (user.workMode === "MAINTENANCE") return "COMPANY_MAINTENANCE";
    return "COMPANY_BOTH";
  }
  return "CLASSIC";
}

const PREVIEW_STORAGE_KEY = "ascure:admin-web:preview-workspace";
const MODE_STORAGE_KEY = "ascure:admin-web:company-mode";
/** Fired on window when the Admin preview or the Survey | Maintenance switch changes. */
export const WORKSPACE_CHANGE_EVENT = "ascure:workspace-change";

export const PREVIEWABLE_WORKSPACES: Workspace[] = [
  "TNB",
  "TNB_SUPERVISOR",
  "COMPANY_MAINTENANCE",
  "COMPANY_SURVEY",
  "COMPANY_BOTH",
  "FIELD_CREW",
  "CLASSIC",
];

export const WORKSPACE_LABELS: Record<Workspace, string> = {
  ADMIN: "Admin Console",
  TNB: "TNB",
  TNB_SUPERVISOR: "TNB Supervisor",
  COMPANY_SURVEY: "Survey company",
  COMPANY_MAINTENANCE: "Maintenance company",
  COMPANY_BOTH: "Main contractor (Survey + Maintenance)",
  FIELD_CREW: "Field crew",
  CLASSIC: "Contractor without a Web view (today's console)",
};

/** Admin-only: the workspace being previewed in this browser tab, or null. */
export function readPreviewWorkspace(): Workspace | null {
  try {
    const value = window.sessionStorage.getItem(PREVIEW_STORAGE_KEY);
    return value && (PREVIEWABLE_WORKSPACES as string[]).includes(value)
      ? (value as Workspace)
      : null;
  } catch {
    return null;
  }
}

export function writePreviewWorkspace(workspace: Workspace | null) {
  try {
    if (workspace) window.sessionStorage.setItem(PREVIEW_STORAGE_KEY, workspace);
    else window.sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
  } catch {
    // Storage blocked: the preview simply doesn't stick.
  }
  window.dispatchEvent(new Event(WORKSPACE_CHANGE_EVENT));
}

/** Main contractor's Survey | Maintenance switch, remembered per browser (L39). */
export function readCompanyMode(): CompanyMode {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === "MAINTENANCE"
      ? "MAINTENANCE"
      : "SURVEY";
  } catch {
    return "SURVEY";
  }
}

export function writeCompanyMode(mode: CompanyMode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Storage blocked: the switch still works for this page view.
  }
  window.dispatchEvent(new Event(WORKSPACE_CHANGE_EVENT));
}

/**
 * Typical flags of the person being previewed, laid over the Admin's session so
 * the preview shows THEIR menu (an Admin has every flag). Menu + home only — the
 * data on every page is still the Admin's.
 */
function previewUser(user: AuthUser, workspace: Workspace): AuthUser {
  const contractor: Partial<AuthUser> = {
    role: "VIEWER",
    isClientViewer: false,
    isClientSupervisor: false,
    canGovernQa: false,
    canReport: false,
    canImport: false,
    canViewRepairVerification: false,
    canViewMaintenancePackages: true,
    canManageClientSupervisors: false,
    canOverseeSubcontractors: false,
  };
  switch (workspace) {
    case "TNB":
      return { ...user, ...contractor, role: "CLIENT", sourceRole: undefined, isClientViewer: true, clientRank: "FOREMAN", canManageClientSupervisors: true, canViewRepairVerification: true, workspace };
    case "TNB_SUPERVISOR":
      return { ...user, ...contractor, role: "CLIENT", sourceRole: undefined, isClientViewer: true, isClientSupervisor: true, clientRank: "SUPERVISOR", canViewRepairVerification: true, workspace };
    case "COMPANY_MAINTENANCE":
      return { ...user, ...contractor, sourceRole: "MANAGER", workMode: "MAINTENANCE", workspace };
    case "COMPANY_SURVEY":
      return { ...user, ...contractor, sourceRole: "MANAGER", workMode: "SURVEY", workspace };
    case "COMPANY_BOTH":
      return { ...user, ...contractor, sourceRole: "MANAGER", workMode: "BOTH", canViewRepairVerification: true, canOverseeSubcontractors: true, workspace };
    case "FIELD_CREW":
      return { ...user, ...contractor, sourceRole: "TECHNICIAN", workMode: "MAINTENANCE", canManageUsers: false, workspace };
    case "CLASSIC":
      return { ...user, ...contractor, sourceRole: "MANAGER", workMode: null, workspace };
    default:
      return user;
  }
}

export type WorkspaceView = {
  /** The workspace in force (the previewed one while an Admin previews). */
  workspace: Workspace;
  /** The user the menu is built for (the preview overlay while previewing). */
  user: AuthUser | null;
  /** True while an Admin previews another workspace. */
  previewing: boolean;
  /** Main contractor only: the side of the Survey | Maintenance switch in force. */
  mode: CompanyMode | null;
  items: NavItem[];
  home: string;
  /** null = every page may be opened (ADMIN, CLASSIC). */
  allowed: ((pathname: string) => boolean) | null;
};

function matches(pathname: string, items: NavItem[], detailPrefixes: string[]) {
  return (
    items.some((navItem) => {
      const path = navPath(navItem.href);
      return pathname === path || pathname.startsWith(`${path}/`);
    }) || detailPrefixes.some((prefix) => pathname.startsWith(prefix))
  );
}

/** Which side of the main contractor's switch a page belongs to (null = either / neither). */
function modeForPath(pathname: string, survey: Menu, maintenance: Menu): CompanyMode | null {
  const inSurvey = matches(pathname, survey.items, []);
  const inMaintenance = matches(pathname, maintenance.items, []);
  if (inSurvey && !inMaintenance) return "SURVEY";
  if (inMaintenance && !inSurvey) return "MAINTENANCE";
  return null;
}

/**
 * Everything the shell and the guard need about the signed-in user's console.
 * Reads browser storage (Admin preview, Survey | Maintenance switch) — call from
 * effects / client components only.
 */
export function resolveWorkspaceView(realUser: AuthUser | null, pathname = ""): WorkspaceView {
  const preview = realUser?.role === "ADMIN" ? readPreviewWorkspace() : null;
  const user = preview && realUser ? previewUser(realUser, preview) : realUser;
  const workspace = preview ?? realUser?.workspace ?? deriveWorkspace(realUser);
  const base = { workspace, user, previewing: preview !== null, mode: null };
  const always = (path: string) => path === "/change-password";

  const fromMenu = (menu: Menu, mode: CompanyMode | null = null): WorkspaceView => ({
    ...base,
    mode,
    items: menu.items,
    home: menu.home,
    allowed: (path) => always(path) || matches(path, menu.items, menu.detailPrefixes),
  });

  switch (workspace) {
    case "TNB":
    case "TNB_SUPERVISOR":
      return fromMenu(tnbMenu(user, workspace === "TNB_SUPERVISOR"));
    case "COMPANY_MAINTENANCE":
      return fromMenu(maintenanceCompanyMenu(user));
    case "COMPANY_SURVEY":
      return fromMenu(surveyCompanyMenu(user));
    case "FIELD_CREW":
      return fromMenu(fieldCrewMenu(user));
    case "COMPANY_BOTH": {
      const survey = surveyCompanyMenu(user);
      const maintenance = maintenanceCompanyMenu(user);
      // An open page decides the side (a bookmarked survey page shows the survey
      // menu); otherwise the remembered switch.
      const mode = modeForPath(pathname, survey, maintenance) ?? readCompanyMode();
      const menu = mode === "MAINTENANCE" ? maintenance : survey;
      return {
        ...fromMenu(menu, mode),
        // Either side's pages may be opened; the switch only changes the menu.
        allowed: (path) =>
          always(path) ||
          matches(path, survey.items, survey.detailPrefixes) ||
          matches(path, maintenance.items, maintenance.detailPrefixes),
      };
    }
    default:
      return {
        ...base,
        items: classicNav(user),
        home: user?.isClientViewer ? "/progress" : "/dashboard",
        allowed: null,
      };
  }
}

/** Main contractor: the home page of one side of the switch. */
export function companyModeHome(user: AuthUser | null, mode: CompanyMode) {
  return mode === "MAINTENANCE"
    ? maintenanceCompanyMenu(user).home
    : surveyCompanyMenu(user).home;
}

/** Where a signed-in user lands (login, and any page outside their workspace). */
export function workspaceHome(user: AuthUser | null) {
  return resolveWorkspaceView(user).home;
}

/** Header label of the user's role ("Manager", "TNB Foreman"). */
export function roleTitle(user: AuthUser | null) {
  if (user?.isClientViewer && user.clientRank) {
    return `TNB ${user.clientRank.charAt(0)}${user.clientRank.slice(1).toLowerCase()}`;
  }
  const role = effectiveRoleOf(user);
  return role ? role.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "";
}
