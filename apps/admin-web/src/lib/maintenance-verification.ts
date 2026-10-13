import { apiRequest } from "@/lib/api";
import type {
  VerificationFilters,
  VerificationGroups,
  VerificationQueue,
  VerificationTab,
} from "@/types/maintenance-verification";

const base = "/maintenance-verification";
const itemPath = (defectId: string, action: string) =>
  `${base}/${encodeURIComponent(defectId)}/${action}`;

function filterQuery(tab: VerificationTab, filters: VerificationFilters & { siteVisitId?: string; page?: number }) {
  const params = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

/** One opened group (or the whole tab): the repairs with their photos. */
export function fetchVerificationQueue(
  token: string,
  tab: VerificationTab,
  filters: VerificationFilters & { siteVisitId?: string } = {},
) {
  const { search: _search, ...rest } = filters;
  void _search;
  return apiRequest<VerificationQueue>(`${base}?${filterQuery(tab, rest)}`, { token });
}

/** Plan §19 (N54): Pencawang + company groups, 20 per page — no photos. */
export function fetchVerificationGroups(
  token: string,
  tab: VerificationTab,
  filters: VerificationFilters,
  page: number,
) {
  return apiRequest<VerificationGroups>(`${base}/groups?${filterQuery(tab, { ...filters, page })}`, { token });
}

export function verifyRepair(token: string, defectId: string, notes: string) {
  return apiRequest(itemPath(defectId, "verify"), {
    method: "POST",
    token,
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

export function rejectRepair(token: string, defectId: string, reason: string) {
  return apiRequest(itemPath(defectId, "reject"), {
    method: "POST",
    token,
    body: JSON.stringify({ reason }),
  });
}

export function reopenRepair(token: string, defectId: string, reason: string) {
  return apiRequest(itemPath(defectId, "reopen"), {
    method: "POST",
    token,
    body: JSON.stringify({ reason }),
  });
}

export function reassignCannotRepair(
  token: string,
  defectId: string,
  maintenanceOrganizationId: string,
  reason: string,
) {
  return apiRequest(itemPath(defectId, "reassign"), {
    method: "POST",
    token,
    body: JSON.stringify({ maintenanceOrganizationId, reason }),
  });
}
