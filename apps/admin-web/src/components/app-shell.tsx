"use client";

import { Building2, ChevronDown, Eye, LogOut, Settings2, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AuthUser, Workspace } from "@/types/auth";
import { readStoredSession } from "@/lib/auth";
import { releasePushOnLogout } from "@/lib/push";
import {
  NAV_ITEMS,
  PREVIEWABLE_WORKSPACES,
  SECTION_LABELS,
  WORKSPACE_CHANGE_EVENT,
  WORKSPACE_LABELS,
  companyModeHome,
  navPath,
  resolveWorkspaceView,
  roleTitle,
  writeCompanyMode,
  writePreviewWorkspace,
  type CompanyMode,
  type NavItem,
  type NavSection,
  type WorkspaceView,
} from "@/lib/workspaces";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";

/** Under the ASCURE wordmark: which console this is (plan §21 header). */
const CONSOLE_TITLES: Record<Workspace, string> = {
  ADMIN: "Admin Console",
  CLASSIC: "Admin Console",
  TNB: "TNB Console",
  TNB_SUPERVISOR: "TNB Console",
  COMPANY_SURVEY: "Survey",
  COMPANY_MAINTENANCE: "Maintenance",
  COMPANY_BOTH: "Survey · Maintenance",
  FIELD_CREW: "Field crew",
};

const MODE_OPTIONS: { value: CompanyMode; label: string }[] = [
  { value: "SURVEY", label: "Survey" },
  { value: "MAINTENANCE", label: "Maintenance" },
];

interface AppShellProps {
  children: React.ReactNode;
  user: AuthUser | null;
  onLogout: () => void;
}

/** null until mounted — the bell renders in exactly ONE place (one poller). */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export function AppShell({ children, user, onLogout: onLogoutProp }: AppShellProps) {
  const isDesktop = useIsDesktop();
  // An explicit sign-out stops this device getting the user's phone alerts.
  // (A session merely expiring does not — the user keeps them after signing back in.)
  const onLogout = () => {
    releasePushOnLogout(readStoredSession()?.token ?? null);
    onLogoutProp();
  };
  const pathname = usePathname();
  const router = useRouter();
  // Plan §21: the user's workspace decides the menu, home page and header. It
  // also reads the Admin preview + the main contractor's Survey | Maintenance
  // switch from browser storage, so re-resolve when either changes.
  const [view, setView] = useState<WorkspaceView>(() =>
    resolveWorkspaceView(user, pathname ?? ""),
  );
  useEffect(() => {
    const update = () => setView(resolveWorkspaceView(user, pathname ?? ""));
    update();
    window.addEventListener(WORKSPACE_CHANGE_EVENT, update);
    return () => window.removeEventListener(WORKSPACE_CHANGE_EVENT, update);
  }, [user, pathname]);

  const visibleNavItems = view.items;
  const viewUser = view.user;
  const switchMode = (mode: CompanyMode) => {
    writeCompanyMode(mode);
    router.push(companyModeHome(viewUser, mode));
  };
  const changePreview = (next: Workspace | null) => {
    writePreviewWorkspace(next);
    router.push(resolveWorkspaceView(user).home);
  };
  const consoleTitle =
    view.workspace === "COMPANY_BOTH"
      ? view.mode === "MAINTENANCE"
        ? "Maintenance"
        : "Survey"
      : CONSOLE_TITLES[view.workspace];
  // Rail identity for a tailored workspace: whose console this is.
  const companyChip =
    view.workspace === "ADMIN" || view.workspace === "CLASSIC"
      ? null
      : view.previewing
        ? WORKSPACE_LABELS[view.workspace]
        : (user?.organizationName ?? null);
  const sections = visibleNavItems.reduce<NavSection[]>(
    (order, navItem) => (order.includes(navItem.section) ? order : [...order, navItem.section]),
    [],
  );

  // The collapsible "Setup" group is an ADMIN-only convenience: every setup item
  // is adminOnly, and a MANAGER's handful of config surfaces (Teams) read better
  // flat. Non-admins render everything flat.
  const isAdmin = user?.role === "ADMIN" && !view.previewing;
  const setupItems = visibleNavItems.filter((item) => item.group === "setup");
  const useSetupGroup = isAdmin && setupItems.length > 0;
  const topNavItems = useSetupGroup
    ? visibleNavItems.filter((item) => item.group !== "setup")
    : visibleNavItems;
  const onSetupPage = setupItems.some(
    (item) => pathname === navPath(item.href) || pathname?.startsWith(`${navPath(item.href)}/`),
  );
  const [setupOpen, setSetupOpen] = useState(onSetupPage);

  const isItemActive = (item: NavItem) =>
    pathname === navPath(item.href) || pathname?.startsWith(`${navPath(item.href)}/`);

  // Breadcrumb source. The workspace menu first (its labels, e.g. "Pencawang"),
  // then every item — including hidden ones and detail routes like /assets/[id] —
  // so drill-throughs still name their section. Longest href wins, so
  // /operational-regions never loses to a shorter prefix.
  const byLength = (a: NavItem, b: NavItem) => navPath(b.href).length - navPath(a.href).length;
  const activeItem =
    visibleNavItems.filter((item) => isItemActive(item)).sort(byLength)[0] ??
    NAV_ITEMS.filter((item) => isItemActive(item)).sort(byLength)[0];

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
              <p className="truncate text-[11px] font-medium text-[var(--on-chrome-muted)]">{consoleTitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            {isDesktop === false && user ? <NotificationBell variant="chrome" /> : null}
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex h-10 w-10 items-center justify-center rounded-[9px] border border-[var(--chrome-line-strong)] text-[var(--on-chrome)] transition hover:bg-[var(--chrome-panel)]"
              aria-label="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        <nav className="flex gap-2 overflow-x-auto px-[14px] pb-4 lg:block lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
          {view.workspace === "COMPANY_BOTH" ? (
            // Main contractor (plan §17 L39 / §21): one console, two menus.
            <div
              role="group"
              aria-label="Work view"
              className="flex shrink-0 rounded-[9px] border border-[var(--chrome-line-strong)] p-0.5 lg:mb-1 lg:mt-1"
            >
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={view.mode === option.value}
                  onClick={() => switchMode(option.value)}
                  className={`h-[32px] flex-1 whitespace-nowrap rounded-[7px] px-3 text-[12.5px] font-semibold transition ${
                    view.mode === option.value
                      ? "bg-[var(--brand)] text-[var(--on-brand)]"
                      : "text-[var(--on-chrome-muted)] hover:bg-[var(--chrome-panel)] hover:text-[var(--on-chrome)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {sections.map((section) => renderSection(section))}
        </nav>

        <div className="hidden px-[14px] pb-[18px] lg:mt-auto lg:block">
          <div className="rounded-[11px] border border-[var(--chrome-line)] bg-[var(--chrome-panel)] p-3.5">
            <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--on-chrome-muted)]">
              <ShieldCheck size={14} />
              {roleTitle(viewUser)}
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
            {user?.role === "ADMIN" ? (
              // Plan §21 (R3): see any workspace's menu, home and header. Data
              // stays the Admin's.
              <label className="mt-2.5 block">
                <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--on-chrome-muted)]">
                  <Eye size={12} />
                  Preview as
                </span>
                <select
                  id="workspace-preview"
                  value={view.previewing ? view.workspace : ""}
                  onChange={(event) =>
                    changePreview((event.target.value || null) as Workspace | null)
                  }
                  className="mt-1 h-[34px] w-full rounded-[8px] border border-[var(--chrome-line-strong)] bg-[var(--chrome)] px-2 text-[12px] text-[var(--on-chrome)]"
                >
                  <option value="">Admin (no preview)</option>
                  {PREVIEWABLE_WORKSPACES.map((workspace) => (
                    <option key={workspace} value={workspace}>
                      {WORKSPACE_LABELS[workspace]}
                    </option>
                  ))}
                </select>
              </label>
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
            global search field here — omitted: the codebase has no search
            endpoint. The 🔔 sits at its right end (plan §19, N56). */}
        <div className="sticky top-0 z-30 hidden h-16 shrink-0 items-center border-b border-[var(--line)] bg-[var(--chrome-translucent)] px-[30px] backdrop-blur-[8px] lg:flex">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium">
            {companyChip ? (
              <>
                <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-[var(--foreground)]">
                  <Building2 size={14} className="shrink-0 text-[var(--muted)]" />
                  <span className="truncate">{companyChip}</span>
                </span>
                <span aria-hidden className="text-[var(--muted-2)]">
                  ·
                </span>
              </>
            ) : null}
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
          {isDesktop === true && user ? (
            <div className="ml-auto">
              <NotificationBell variant="rail" />
            </div>
          ) : null}
        </div>

        {view.previewing ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--info-border)] bg-[var(--info-bg)] px-4 py-2 text-[12.5px] text-[var(--info-text)] lg:px-[30px]">
            <Eye size={15} className="shrink-0" />
            <span className="min-w-0 flex-1">
              Previewing <b>{WORKSPACE_LABELS[view.workspace]}</b>: menu, home page and header only.
              The data on each page is still yours as Admin.
            </span>
            <button
              type="button"
              onClick={() => changePreview(null)}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-[var(--info-border)] bg-[var(--panel)] px-2.5 font-semibold text-[var(--info-text)] transition hover:bg-[var(--panel-muted)]"
            >
              <X size={14} />
              Exit preview
            </button>
          </div>
        ) : null}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
