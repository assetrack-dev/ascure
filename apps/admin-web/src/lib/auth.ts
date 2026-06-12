"use client";

import type { ApiUser, AuthSession, AuthUser } from "@/types/auth";
import { normalizeRole } from "@/lib/roles";
import { apiRequest } from "@/lib/api";

const TOKEN_STORAGE_KEY = "ascure:admin-web:token";
const USER_STORAGE_KEY = "ascure:admin-web:user";
const LAST_EMAIL_STORAGE_KEY = "ascure_last_email";

export function normalizeAuthUser(user: ApiUser | AuthUser | null | undefined): AuthUser | null {
  if (!user) {
    return null;
  }

  const sourceRole = "sourceRole" in user ? user.sourceRole ?? user.role : user.role;

  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: normalizeRole(user.role),
    sourceRole: sourceRole && sourceRole !== normalizeRole(user.role) ? sourceRole : undefined,
    organizationId: "organizationId" in user ? user.organizationId : undefined,
    mustChangePassword:
      "mustChangePassword" in user ? user.mustChangePassword : undefined,
    canGovernQa: "canGovernQa" in user ? user.canGovernQa : undefined,
    canReport: "canReport" in user ? user.canReport : undefined,
    canImport: "canImport" in user ? user.canImport : undefined,
    canReassign: "canReassign" in user ? user.canReassign : undefined,
    canManageSupervisors:
      "canManageSupervisors" in user ? user.canManageSupervisors : undefined,
    canManageUsers: "canManageUsers" in user ? user.canManageUsers : undefined,
  };
}

/**
 * Re-fetches the current user from /auth/me and updates the stored user, so
 * server-computed permission flags (e.g. canGovernQa) reflect the latest server
 * state without a full logout/login. Returns the refreshed user. Throws if the
 * request fails — callers treat network errors as non-fatal (keep the cached
 * session); a 401 means the token is no longer valid.
 */
export async function refreshStoredSessionUser(token: string): Promise<AuthUser | null> {
  const apiUser = await apiRequest<ApiUser>("/auth/me", { token });
  const user = normalizeAuthUser(apiUser);

  if (typeof window !== "undefined") {
    if (user) {
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(USER_STORAGE_KEY);
    }
  }

  return user;
}

export function readStoredSession(): AuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);

  if (!token) {
    return null;
  }

  const storedUser = window.localStorage.getItem(USER_STORAGE_KEY);

  if (!storedUser) {
    return {
      token,
      user: null,
    };
  }

  try {
    return {
      token,
      user: normalizeAuthUser(JSON.parse(storedUser)),
    };
  } catch {
    window.localStorage.removeItem(USER_STORAGE_KEY);

    return {
      token,
      user: null,
    };
  }
}

export function persistSession(session: AuthSession) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, session.token);

  if (session.user) {
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
    return;
  }

  window.localStorage.removeItem(USER_STORAGE_KEY);
}

export function clearStoredSession() {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
}

export function readLastLoginEmail() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(LAST_EMAIL_STORAGE_KEY) ?? "";
}

export function persistLastLoginEmail(email: string) {
  const trimmedEmail = email.trim();

  if (trimmedEmail) {
    window.localStorage.setItem(LAST_EMAIL_STORAGE_KEY, trimmedEmail);
  }
}
