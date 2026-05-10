import { apiRequest } from "@/lib/api";
import type { CreateUserPayload, ManagedUser, UpdateUserPayload } from "@/types/users";

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

export function createUser(token: string, payload: CreateUserPayload) {
  return apiRequest<ManagedUser>("/users", {
    method: "POST",
    token,
    body: JSON.stringify({
      name: payload.name,
      email: payload.email,
      password: payload.password,
      role: payload.role,
      isActive: payload.isActive ?? true,
      departmentId: normalizeDepartmentId(payload.departmentId),
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
    }),
  });
}

export function resetUserPassword(token: string, userId: string, password: string) {
  return apiRequest<ManagedUser>(`/users/${encodeURIComponent(userId)}/password`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ password }),
  });
}

export function updateUserStatus(token: string, userId: string, isActive: boolean) {
  return apiRequest<ManagedUser>(`/users/${encodeURIComponent(userId)}/status`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ isActive }),
  });
}
