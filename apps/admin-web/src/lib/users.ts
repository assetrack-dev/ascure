import { apiRequest } from "@/lib/api";
import type {
  CreateUserPayload,
  ManagedTeam,
  ManagedUser,
  ProvisionedUser,
  UpdateUserPayload,
} from "@/types/users";

function normalizeDepartmentId(departmentId: string | null | undefined) {
  if (departmentId === undefined) {
    return undefined;
  }

  if (departmentId === null) {
    return null;
  }

  const trimmedDepartmentId = departmentId.trim();

  return trimmedDepartmentId ? trimmedDepartmentId : null;
}

export function fetchUsers(token: string) {
  return apiRequest<ManagedUser[]>("/users", { token });
}

export function fetchTeams(token: string) {
  return apiRequest<ManagedTeam[]>("/teams", { token });
}

export function createUser(token: string, payload: CreateUserPayload) {
  return apiRequest<ProvisionedUser>("/users", {
    method: "POST",
    token,
    body: JSON.stringify({
      name: payload.name,
      email: payload.email,
      // Omitted when blank ⇒ the server generates + returns a temporary password.
      password: payload.password ? payload.password : undefined,
      role: payload.role,
      isActive: payload.isActive ?? true,
      departmentId: normalizeDepartmentId(payload.departmentId),
      organizationId: normalizeDepartmentId(payload.organizationId),
      branchId: normalizeDepartmentId(payload.branchId),
      mainheadId: normalizeDepartmentId(payload.mainheadId),
      teamId: normalizeDepartmentId(payload.teamId),
      capabilityIds: payload.capabilityIds,
      mainheadAccessIds: payload.mainheadAccessIds,
      operationalRegionAccessIds: payload.operationalRegionAccessIds,
    }),
  });
}

export function updateUser(token: string, userId: string, payload: UpdateUserPayload) {
  return apiRequest<ManagedUser>(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    token,
    body: JSON.stringify({
      ...payload,
      departmentId: normalizeDepartmentId(payload.departmentId),
      organizationId: normalizeDepartmentId(payload.organizationId),
      branchId: normalizeDepartmentId(payload.branchId),
      mainheadId: normalizeDepartmentId(payload.mainheadId),
      teamId: normalizeDepartmentId(payload.teamId),
      capabilityIds: payload.capabilityIds ?? [],
      mainheadAccessIds: payload.mainheadAccessIds,
      operationalRegionAccessIds: payload.operationalRegionAccessIds,
    }),
  });
}

export function resetUserPassword(token: string, userId: string, password?: string) {
  return apiRequest<ProvisionedUser>(`/users/${encodeURIComponent(userId)}/password`, {
    method: "PATCH",
    token,
    // Blank ⇒ the server generates + returns a temporary password to relay.
    body: JSON.stringify(password ? { password } : {}),
  });
}

export function updateUserStatus(token: string, userId: string, isActive: boolean) {
  return apiRequest<ManagedUser>(`/users/${encodeURIComponent(userId)}/status`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ isActive }),
  });
}
