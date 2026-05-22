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

export interface OperationalOption {
  id: string;
  name: string;
  code?: string | null;
  isActive?: boolean | null;
}

export interface CapabilityAssignment {
  id: string;
  isActive: boolean;
  capability: OperationalOption & {
    description?: string | null;
  };
}

export interface ManagedTeam {
  id: string;
  tenantId: string;
  departmentId: string | null;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  organization?: OperationalOption | null;
  branch?: (OperationalOption & { organizationId?: string | null; region?: string | null }) | null;
  mainhead?: (OperationalOption & { branchId?: string | null }) | null;
  capabilityAssignments?: CapabilityAssignment[];
}

export interface ManagedUser {
  id: string;
  tenantId: string;
  departmentId: string | null;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  teamId?: string | null;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  department: UserDepartment | null;
  organization?: OperationalOption | null;
  branch?: (OperationalOption & { organizationId?: string | null; region?: string | null }) | null;
  mainhead?: (OperationalOption & { branchId?: string | null }) | null;
  team?: ManagedTeam | null;
  capabilityAssignments?: CapabilityAssignment[];
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  isActive?: boolean;
  departmentId?: string | null;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  teamId?: string | null;
  capabilityIds?: string[];
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  role?: UserRole;
  departmentId?: string | null;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  teamId?: string | null;
  capabilityIds?: string[];
}
