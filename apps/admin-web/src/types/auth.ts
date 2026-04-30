import type { AppRole } from "@/lib/roles";

export interface ApiUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: AppRole;
  sourceRole?: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser | null;
}

export interface LoginResponse {
  access_token: string;
  user: ApiUser;
}
