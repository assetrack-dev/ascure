export const USER_ROLES = [
  "ADMIN",
  "MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
  "VIEWER",
  "CLIENT",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface UserDepartment {
  id: string;
  code: string;
  name: string;
}

export interface ManagedUser {
  id: string;
  tenantId: string;
  departmentId: string | null;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  department: UserDepartment | null;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  isActive?: boolean;
  departmentId?: string | null;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  role?: UserRole;
  departmentId?: string | null;
}
