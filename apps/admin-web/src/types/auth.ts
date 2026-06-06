import type { AppRole } from "@/lib/roles";

export interface ApiUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  canGovernQa?: boolean;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: AppRole;
  sourceRole?: string;
  /**
   * Server-provided authority to perform defect QA governance
   * (verify/reject/closure) — ADMIN or an ASCURE QA actor with QA_VALIDATION.
   * Mirrors the API guards so the UI never has to guess from role (note that
   * MANAGER is normalized to VIEWER client-side, so role alone is insufficient).
   */
  canGovernQa?: boolean;
}

export interface AuthSession {
  token: string;
  user: AuthUser | null;
}

export interface LoginResponse {
  access_token: string;
  user: ApiUser;
}
