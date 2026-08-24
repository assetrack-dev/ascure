import { apiRequest } from "@/lib/api";

export interface TeamOption {
  id: string;
  name: string | null;
  code: string | null;
  organizationId: string | null;
  organizationName: string | null;
  isActive: boolean;
}

function asArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    for (const key of ["data", "items", "teams", "results"]) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
}

function readStr(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Active teams the signed-in user can see — used for the reassignment picker. */
export async function fetchTeams(token: string): Promise<TeamOption[]> {
  const payload = await apiRequest<unknown>("/teams", { token });

  return asArray(payload)
    .map((raw): TeamOption | null => {
      if (!raw || typeof raw !== "object") {
        return null;
      }

      const record = raw as Record<string, unknown>;
      const id = readStr(record, "id");

      if (!id) {
        return null;
      }

      const organization =
        record.organization && typeof record.organization === "object"
          ? (record.organization as Record<string, unknown>)
          : null;

      return {
        id,
        name: readStr(record, "name"),
        code: readStr(record, "code"),
        organizationId: readStr(record, "organizationId"),
        organizationName: organization
          ? (readStr(organization, "name") ?? readStr(organization, "code"))
          : null,
        isActive: record.isActive !== false,
      };
    })
    .filter((team): team is TeamOption => team !== null);
}
