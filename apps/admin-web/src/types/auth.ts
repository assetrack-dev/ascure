import type { AppRole } from "@/lib/roles";

export interface ApiUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  organizationId?: string | null;
  organizationName?: string | null;
  mustChangePassword?: boolean;
  canGovernQa?: boolean;
  canReport?: boolean;
  canImport?: boolean;
  canReassign?: boolean;
  canManageSupervisors?: boolean;
  canManageUsers?: boolean;
  canManageMaintenance?: boolean;
  canReviewSurvey?: boolean;
  canDeleteSurvey?: boolean;
  canOverseeSubcontractors?: boolean;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: AppRole;
  sourceRole?: string;
  /** The user's own company (Organization) — used to scope/lock a manager's
   *  user-provisioning form to their own company. */
  organizationId?: string | null;
  /** The user's company display name — shown in the app shell. */
  organizationName?: string | null;
  /** First-login / post-reset forced password change. When true the client
   *  routes the user to the change-password screen before anything else. */
  mustChangePassword?: boolean;
  /**
   * Server-provided authority to perform defect QA governance
   * (verify/reject/closure) — ADMIN or an ASCURE QA actor with QA_VALIDATION.
   * Mirrors the API guards so the UI never has to guess from role (note that
   * MANAGER is normalized to VIEWER client-side, so role alone is insufficient).
   */
  canGovernQa?: boolean;
  /**
   * Server-provided authority to access reporting / export features — ADMIN or
   * a user with an effective REPORTING capability. Mirrors the API gate so the
   * UI can show the Reports area exactly when the API would authorize it.
   */
  canReport?: boolean;
  /**
   * Server-provided authority to run AppSheet / bulk imports — ADMIN or a user
   * with an effective IMPORT capability. Mirrors the API gate so the UI shows the
   * Imports area exactly when the API would authorize it.
   */
  canImport?: boolean;
  /**
   * Server-provided authority to reassign a site visit to another team
   * (ADR 0002) — ADMIN / MANAGER / SUPERVISOR. Mirrors the API gate so the admin
   * console can show the reassign control even though MANAGER/SUPERVISOR collapse
   * to VIEWER client-side.
   */
  canReassign?: boolean;
  /**
   * Server-provided authority to manage a team's supervisor links (ADR 0002 §3)
   * — ADMIN or MANAGER (own company). Mirrors the API gate so the admin console
   * can show the supervisor-management control even though MANAGER collapses to
   * VIEWER client-side.
   */
  canManageSupervisors?: boolean;
  /**
   * Server-provided authority to provision/manage users — ADMIN (all users) or
   * MANAGER (own company). Mirrors the API gate so the console can show the
   * Users area + provisioning controls even though MANAGER collapses to VIEWER
   * client-side. The /users endpoints still enforce the company scope + role
   * allow-list server-side.
   */
  canManageUsers?: boolean;
  /**
   * Server-provided authority to dispatch maintenance work for the company's
   * routed defect pool — assign a routed defect to the company's own team/tech,
   * or delegate it to a subcontractor. ADMIN or MANAGER. Mirrors the API gate so
   * the console can show the assign/delegate controls even though MANAGER
   * collapses to VIEWER client-side; the defect endpoints still enforce org-scope.
   */
  canManageMaintenance?: boolean;
  /**
   * Server-provided authority to review + approve a submitted survey (the
   * technician/supervisor → MANAGER → DC gate) — ADMIN or MANAGER. Mirrors the
   * API gate so the admin console can show the manager approve / send-back
   * controls even though MANAGER collapses to VIEWER client-side; the lifecycle
   * endpoints still enforce the role + company scope server-side.
   */
  canReviewSurvey?: boolean;
  /** ADMIN or MANAGER — can hard-delete a survey / Pencawang (API scopes a MANAGER to own company). */
  canDeleteSurvey?: boolean;
  /**
   * MAIN_CONTRACTOR manager overseeing an active subcontractor subtree. The
   * Assets page shows such a manager the subcontractor subtree's assets AND the
   * delete controls (the API scopes both to own org + that subtree). False for
   * everyone else, incl. a manager with no subcontractors.
   */
  canOverseeSubcontractors?: boolean;
}

export interface AuthSession {
  token: string;
  user: AuthUser | null;
}

export interface LoginResponse {
  access_token: string;
  user: ApiUser;
}
