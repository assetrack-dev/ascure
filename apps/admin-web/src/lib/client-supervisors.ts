import { apiRequest } from "@/lib/api";

/** TNB Supervisors ↔ contractor companies (docs/PLAN-maintenance-flow.md §19, N55). */

export interface SupervisorCompany {
  id: string;
  name: string;
  isActive?: boolean;
}

export interface ClientSupervisor {
  userId: string;
  name: string;
  email: string;
  isActive: boolean;
  tnb: { id: string; name: string } | null;
  companies: SupervisorCompany[];
}

export interface ClientSupervisorsResponse {
  supervisors: ClientSupervisor[];
  companies: Array<{ id: string; name: string; code: string | null; type: string }>;
}

export function fetchClientSupervisors(token: string) {
  return apiRequest<ClientSupervisorsResponse>("/client-supervisors", { token });
}

export function setSupervisorCompanies(token: string, userId: string, organizationIds: string[]) {
  return apiRequest<ClientSupervisor>(`/client-supervisors/${encodeURIComponent(userId)}/companies`, {
    method: "PUT",
    token,
    body: JSON.stringify({ organizationIds }),
  });
}
