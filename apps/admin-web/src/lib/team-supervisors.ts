import { apiRequest } from "@/lib/api";

/**
 * Admin-console data layer for managing the supervisor↔team links that drive
 * role-aware visibility and supervisor reassign (ADR 0002 §3).
 */
export interface TeamSupervisorUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface TeamSupervisorsView {
  teamId: string;
  teamName: string;
  /** Users currently supervising the team. */
  supervisors: TeamSupervisorUser[];
  /** Eligible pool: active SUPERVISOR-role users in the team's company. */
  candidates: TeamSupervisorUser[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeUser(value: unknown): TeamSupervisorUser | null {
  const record = asRecord(value);
  const id = typeof record.id === "string" ? record.id : null;

  if (!id) {
    return null;
  }

  return {
    id,
    name: typeof record.name === "string" ? record.name : "",
    email: typeof record.email === "string" ? record.email : "",
    role: typeof record.role === "string" ? record.role : "",
  };
}

function normalizeUsers(value: unknown): TeamSupervisorUser[] {
  return Array.isArray(value)
    ? value
        .map(normalizeUser)
        .filter((user): user is TeamSupervisorUser => user !== null)
    : [];
}

function normalizeView(payload: unknown): TeamSupervisorsView {
  const record = asRecord(payload);

  return {
    teamId: typeof record.teamId === "string" ? record.teamId : "",
    teamName: typeof record.teamName === "string" ? record.teamName : "",
    supervisors: normalizeUsers(record.supervisors),
    candidates: normalizeUsers(record.candidates),
  };
}

export async function fetchTeamSupervisors(
  token: string,
  teamId: string,
): Promise<TeamSupervisorsView> {
  const payload = await apiRequest<unknown>(
    `/teams/${encodeURIComponent(teamId)}/supervisors`,
    { token },
  );

  return normalizeView(payload);
}

export async function setTeamSupervisors(
  token: string,
  teamId: string,
  supervisorUserIds: string[],
): Promise<TeamSupervisorsView> {
  const payload = await apiRequest<unknown>(
    `/teams/${encodeURIComponent(teamId)}/supervisors`,
    {
      method: "PUT",
      token,
      body: JSON.stringify({ supervisorUserIds }),
    },
  );

  return normalizeView(payload);
}
