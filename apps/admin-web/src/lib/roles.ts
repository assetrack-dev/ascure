export const APP_ROLES = ["ADMIN", "VIEWER", "CLIENT"] as const;

export type AppRole = (typeof APP_ROLES)[number];

const BACKEND_ROLE_MAP: Record<string, AppRole> = {
  ADMIN: "ADMIN",
  CLIENT: "CLIENT",
  VIEWER: "VIEWER",
  MANAGER: "VIEWER",
  SUPERVISOR: "VIEWER",
  TECHNICIAN: "VIEWER",
};

export function normalizeRole(role: string | null | undefined): AppRole {
  if (!role) {
    return "VIEWER";
  }

  return BACKEND_ROLE_MAP[role.toUpperCase()] ?? "VIEWER";
}

export function roleLabel(role: string | null | undefined) {
  return normalizeRole(role).toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function canAccessRole(role: string | null | undefined, allowedRoles: AppRole[]) {
  return allowedRoles.includes(normalizeRole(role));
}

export function requireRole(role: string | null | undefined, allowedRoles: AppRole[]) {
  if (!canAccessRole(role, allowedRoles)) {
    throw new Error("You do not have access to this admin area.");
  }
}
