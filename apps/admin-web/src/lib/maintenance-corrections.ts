import { apiRequest } from "@/lib/api";

/** A kind of repair (plan §20, P2) — e.g. Rentis: KAEDAH LAZIM, Lain-lain. */
export type RepairMethod = {
  id: string;
  category: "RENTIS" | "CAT_TIANG" | "SELENGGARAAN";
  code: string;
  label: string;
  requiresNote: boolean;
};

export type RepairMethodAdminRow = RepairMethod & {
  sortOrder: number;
  isActive: boolean;
  /** Kejanggalan that carry this type — retire instead of renaming its meaning. */
  usedCount: number;
};

/** The kind of repair recorded on a Kejanggalan. */
export type DefectRepairMethod = { id: string; label: string | null; note: string | null };

/** Active kinds of repair (crew + office pickers). */
export function fetchRepairMethods(token: string, category?: string) {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  return apiRequest<RepairMethod[]>(`/maintenance-work/repair-methods${query}`, { token });
}

/** Set / correct (or clear with null) the kind of repair — until TNB verifies. */
export function saveDefectRepairMethod(
  token: string,
  defectId: string,
  repairMethodId: string | null,
  note: string | null,
) {
  return apiRequest<{ id: string; repairMethod: DefectRepairMethod | null }>(
    `/maintenance-work/defects/${encodeURIComponent(defectId)}/repair-method`,
    { token, method: "PATCH", body: JSON.stringify({ repairMethodId, note }) },
  );
}

/** Delete a repair photo — archived on the server, never lost (plan §20, P1). */
export function deleteRepairPhoto(token: string, imageId: string) {
  return apiRequest<{ id: string; deleted: boolean }>(
    `/maintenance-work/evidence/${encodeURIComponent(imageId)}`,
    { token, method: "DELETE" },
  );
}

/** Move a repair photo to another stage (fix a wrong Before / After). */
export function relabelRepairPhoto(token: string, imageId: string, evidenceType: "BEFORE" | "DURING" | "AFTER") {
  return apiRequest<{ id: string; evidenceType: string }>(
    `/maintenance-work/evidence/${encodeURIComponent(imageId)}`,
    { token, method: "PATCH", body: JSON.stringify({ evidenceType }) },
  );
}

// ── ADMIN: manage the list ────────────────────────────────────────────────

export function fetchRepairMethodsAdmin(token: string) {
  return apiRequest<RepairMethodAdminRow[]>("/repair-methods", { token });
}

export function createRepairMethod(
  token: string,
  input: { category: RepairMethod["category"]; label: string; requiresNote: boolean },
) {
  return apiRequest<RepairMethodAdminRow>("/repair-methods", {
    token,
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateRepairMethod(
  token: string,
  id: string,
  input: Partial<{ label: string; requiresNote: boolean; sortOrder: number; isActive: boolean }>,
) {
  return apiRequest<RepairMethodAdminRow>(`/repair-methods/${encodeURIComponent(id)}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
